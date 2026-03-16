import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const GOG = process.env.GOG_PATH || '/usr/local/bin/gog';

async function runGog(...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(GOG, args, { timeout: 25_000 });
  return stdout.trim();
}

export async function fetchCalendar(): Promise<string> {
  return runGog('calendar', 'events', '--today', '--all');
}

export async function fetchGmail(): Promise<string> {
  return runGog(
    'gmail',
    'messages',
    'search',
    'is:unread -category:promotions -category:social -category:forums',
    '--max',
    '10',
  );
}

export async function fetchUSPSEmails(): Promise<string> {
  const yesterday = new Date(Date.now() - 86_400_000)
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, '/');
  return runGog(
    'gmail',
    'messages',
    'search',
    `from:USPSInformedDelivery after:${yesterday}`,
    '--max',
    '3',
  );
}

export async function fetchAmazonEmails(): Promise<string> {
  const yesterday = new Date(Date.now() - 86_400_000)
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, '/');
  return runGog(
    'gmail',
    'messages',
    'search',
    `from:Amazon after:${yesterday}`,
    '--max',
    '5',
  );
}

export interface BriefInput {
  calendar: string;
  gmail: string;
  usps: string;
  amazon: string;
}

export async function generateBrief(input: BriefInput): Promise<string> {
  const prompt = `Generate Lenny's morning brief for today.

**Calendar:**
${input.calendar || 'No events today.'}

**Unread Email (important only):**
${input.gmail || 'No unread emails.'}

**USPS Informed Delivery:**
${input.usps || 'Nothing from USPS.'}

**Amazon Shipping/Delivery:**
${input.amazon || 'Nothing from Amazon.'}

Requirements:
- Keep it concise (10–20 lines), high-signal.
- Sections: opening line (dangerous-muse vibe, include 😘), calendar, lunch check (flag meetings 11am-2pm and anything within 30 min after), email (max 5 items), USPS, Amazon, end with one "small dare".`;

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
  return data.choices[0].message.content;
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
