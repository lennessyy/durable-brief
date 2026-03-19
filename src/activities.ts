import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const execFileAsync = promisify(execFile);

const GOG = process.env.GOG_PATH || '/usr/local/bin/gog';
const TESSERACT = process.env.TESSERACT_PATH || '/usr/bin/tesseract';

async function runGog(...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(GOG, args, { timeout: 25_000 });
  return stdout.trim();
}

export async function fetchCalendar(): Promise<string> {
  return runGog('calendar', 'events', '--today', '--all');
}

export async function fetchEmails(): Promise<string> {
  const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000)
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, '/');

  // Fetch unread emails excluding USPS and Amazon (they have their own sections)
  const unread = await runGog(
    'gmail',
    'messages',
    'search',
    `is:unread after:${twoDaysAgo} -category:promotions -category:social -category:forums -from:USPSInformedDelivery -from:Amazon`,
    '--max',
    '20',
  );

  return unread || 'No unread emails (USPS and Amazon have their own sections).';
}

interface Attachment {
  filename: string;
  mimeType: string;
  attachmentId: string;
}

interface GmailMessage {
  attachments?: Attachment[];
}

interface GmailSearchResult {
  messages?: { id: string }[];
}

export async function fetchUSPSMailScans(): Promise<string> {
  const yesterday = new Date(Date.now() - 86_400_000)
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, '/');

  // Find the latest USPS Informed Delivery email
  const searchResult = await runGog(
    'gmail',
    'messages',
    'search',
    `from:USPSInformedDelivery after:${yesterday}`,
    '--max',
    '1',
    '--json',
  );

  const search: GmailSearchResult = JSON.parse(searchResult);
  if (!search.messages?.length) {
    return 'No USPS Informed Delivery email today.';
  }

  const messageId = search.messages[0].id;

  // Get the full message to find image attachments
  const messageResult = await runGog('gmail', 'get', messageId, '--json');
  const message: GmailMessage = JSON.parse(messageResult);

  // Filter to actual mail scans only — USPS ads use "content-" prefixed filenames
  const imageAttachments = (message.attachments ?? []).filter(
    (a) => a.mimeType.startsWith('image/') && !a.filename.startsWith('content-'),
  );

  if (!imageAttachments.length) {
    return 'USPS email found but no mail scan images.';
  }

  // Download and OCR each image
  const tmpDir = await mkdtemp(join(tmpdir(), 'usps-'));
  try {
    const results: string[] = [];

    for (const [i, attachment] of imageAttachments.entries()) {
      const imgPath = join(tmpDir, `mail-${i}.jpg`);

      // Download the attachment
      await execFileAsync(
        GOG,
        [
          'gmail',
          'attachment',
          messageId,
          attachment.attachmentId,
          '--out',
          imgPath,
        ],
        { timeout: 15_000 },
      );

      // OCR with tesseract
      const { stdout } = await execFileAsync(TESSERACT, [imgPath, 'stdout', '--psm', '11'], {
        timeout: 10_000,
      });

      const text = stdout.trim();
      if (text) {
        results.push(`Mail piece ${i + 1}:\n${text}`);
      }
    }

    return results.length
      ? results.join('\n\n')
      : 'USPS scans found but no readable text detected.';
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

export interface BriefInput {
  calendar: string;
  emails: string;
  uspsScans: string;
}

export async function generateBrief(input: BriefInput): Promise<string> {
  const prompt = `Generate Lenny's morning brief for today.

**Calendar:**
${input.calendar || 'No events today.'}

**Email (all unread from last 48h):**
${input.emails || 'No unread emails.'}

**USPS Informed Delivery (OCR from mail scans):**
${input.uspsScans || 'Nothing from USPS.'}

Requirements:
- Keep it concise (10–20 lines), high-signal.
- Sections: opening line (dangerous-muse vibes), calendar, lunch check (flag meetings 11am-2pm and anything within 30 min after), email (max 5 items, skip subscription agreement updates), USPS (who the mail is FROM based on the OCR text - this is important since there's no item data. OCR text are often garbled, so use heuristics to guess the sender.), Amazon (just the item name, no sender needed), end with one "small dare".`;

  const body = JSON.stringify({
    model: process.env.LLM_MODEL || 'llama-3.3-70b',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 2048,
  });

  const res = await fetch(
    process.env.LLM_BASE_URL || 'https://api.venice.ai/api/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.LLM_API_KEY}`,
      },
      body,
      signal: AbortSignal.timeout(55_000),
    },
  );

  if (!res.ok) {
    throw new Error(`LLM API error: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as {
    choices: { message: { content: string } }[];
  };
  const content = data.choices[0]?.message?.content;
  if (!content) {
    throw new Error('LLM returned an empty brief');
  }
  return content;
}

export interface LunchMeeting {
  title: string;
  startHour: number;
  startMinute: number;
  timeStr: string;
}

export async function parseLunchMeetings(calendarText: string): Promise<LunchMeeting[]> {
  if (!calendarText) return [];

  const meetings: LunchMeeting[] = [];
  const lines = calendarText.split('\n');

  // Match time patterns like "12:30 PM", "1:00 PM", "13:00", "12:30pm"
  const timePattern = /(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?/;

  for (const line of lines) {
    const match = line.match(timePattern);
    if (!match) continue;

    // Skip personal lunch events - only track actual meetings
    if (line.toLowerCase().includes('lunch')) continue;

    let hour = parseInt(match[1], 10);
    const minute = parseInt(match[2], 10);
    const ampm = match[3]?.toUpperCase();

    if (ampm === 'PM' && hour !== 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;

    // Check if meeting starts between 12:00 and 14:00 (exclusive)
    if (hour >= 12 && hour < 14) {
      meetings.push({
        title: line.trim(),
        startHour: hour,
        startMinute: minute,
        timeStr: match[0],
      });
    }
  }

  // Sort by start time
  meetings.sort((a, b) => a.startHour * 60 + a.startMinute - (b.startHour * 60 + b.startMinute));
  return meetings;
}

export async function sendToTelegram(message: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    throw new Error('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set');
  }

  const res = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown',
      }),
      signal: AbortSignal.timeout(8_000),
    },
  );

  if (!res.ok) {
    throw new Error(`Telegram API error: ${res.status} ${await res.text()}`);
  }
}
