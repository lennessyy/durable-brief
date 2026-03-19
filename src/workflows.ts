import { proxyActivities, defineSignal, defineQuery, setHandler, condition, log } from '@temporalio/workflow';
import type * as activities from './activities';

const gog = proxyActivities<typeof activities>({
  startToCloseTimeout: '30s',
  retry: {
    maximumAttempts: 5,
    initialInterval: '5s',
    backoffCoefficient: 2,
  },
});

const usps = proxyActivities<typeof activities>({
  startToCloseTimeout: '45s',
  retry: {
    maximumAttempts: 5,
    initialInterval: '5s',
    backoffCoefficient: 2,

  },
});

const llm = proxyActivities<typeof activities>({
  startToCloseTimeout: '60s',
  retry: {
    maximumAttempts: 5,
    initialInterval: '10s',
    backoffCoefficient: 2,
  },
});

const delivery = proxyActivities<typeof activities>({
  startToCloseTimeout: '15s',
  retry: {
    maximumAttempts: 5,
    initialInterval: '3s',
    backoffCoefficient: 2,
  },
});

const reminder = proxyActivities<typeof activities>({
  startToCloseTimeout: '15s',
  retry: {
    maximumAttempts: 3,
    initialInterval: '3s',
    backoffCoefficient: 2,
  },
});

export const stopRemindersSignal = defineSignal('stopReminders');
export const briefQuery = defineQuery<string | null>('getBrief');

export async function morningBriefWorkflow(): Promise<string> {
  let briefResult: string | null = null;

  setHandler(briefQuery, () => briefResult);

  log.info('Starting morning brief workflow');

  // Fetch all data in parallel — each retries independently
  const [calendar, emails, uspsScans] = await Promise.all([
    gog.fetchCalendar(),
    gog.fetchEmails(),
    usps.fetchUSPSMailScans(),
  ]);

  log.info('All data fetched, generating brief');

  const brief = await llm.generateBrief({ calendar, emails, uspsScans });

  log.info('Brief generated, sending to Telegram');

  await delivery.sendToTelegram(brief);

  briefResult = brief;

  log.info('Morning brief delivered, checking for lunch meetings');

  // Check for lunch meetings between 12:00 PM and 2:00 PM
  const lunchMeetings = await reminder.parseLunchMeetings(calendar);

  if (lunchMeetings.length > 0) {
    log.info(`Found ${lunchMeetings.length} lunch meeting(s), setting up reminders`);
    await sendLunchReminders(lunchMeetings);
  }

  log.info('Morning brief workflow complete');
  return brief;
}

async function sendLunchReminders(meetings: activities.LunchMeeting[]): Promise<void> {
  let stopped = false;

  setHandler(stopRemindersSignal, () => {
    log.info('Received stop signal, cancelling reminders');
    stopped = true;
  });

  for (const meeting of meetings) {
    if (stopped) break;

    // Build today's meeting timestamp
    const now = new Date(Date.now());
    const meetingTime = new Date(now);
    meetingTime.setHours(meeting.startHour, meeting.startMinute, 0, 0);
    const meetingMs = meetingTime.getTime();

    // --- 30-minute reminder ---
    const thirtyMinBefore = meetingMs - 30 * 60 * 1000;
    let waitMs = thirtyMinBefore - Date.now();

    if (waitMs > 0) {
      const wasStoppedEarly = await condition(() => stopped, waitMs);
      if (wasStoppedEarly) break;
    }

    if (!stopped && Date.now() < meetingMs) {
      await delivery.sendToTelegram(
        `⏰ *30 min reminder:* ${meeting.title}\n\n_Reply STOP to cancel reminders._`,
      );
      log.info(`Sent 30-min reminder for: ${meeting.title}`);
    }

    // --- 10-minute reminder ---
    const tenMinBefore = meetingMs - 10 * 60 * 1000;
    waitMs = tenMinBefore - Date.now();

    if (waitMs > 0) {
      const wasStoppedEarly = await condition(() => stopped, waitMs);
      if (wasStoppedEarly) break;
    }

    if (!stopped && Date.now() < meetingMs) {
      await delivery.sendToTelegram(
        `⏰ *10 min reminder:* ${meeting.title}`,
      );
      log.info(`Sent 10-min reminder for: ${meeting.title}`);
    }
  }
}
