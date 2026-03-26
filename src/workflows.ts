import { proxyActivities, defineSignal, defineQuery, setHandler, condition, log, ActivityFailure } from '@temporalio/workflow';
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
  startToCloseTimeout: '2m',
  scheduleToCloseTimeout: '15m',
  retry: {
    maximumAttempts: 10,
    initialInterval: '15s',
    backoffCoefficient: 2,
    maximumInterval: '3m',
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
  let stopped = false;

  setHandler(briefQuery, () => briefResult);
  setHandler(stopRemindersSignal, () => {
    log.info('Received stop signal, cancelling reminders');
    stopped = true;
  });

  log.info('Starting morning brief workflow');

  // Fetch all data in parallel — each retries independently
  const [calendar, emails, uspsScans] = await Promise.all([
    gog.fetchCalendar(),
    gog.fetchEmails(),
    usps.fetchUSPSMailScans(),
  ]);

  log.info('All data fetched, parsing lunch meetings and generating brief');

  // Parse lunch meetings and generate brief in parallel — they're independent
  const [lunchMeetings] = await Promise.all([
    reminder.parseLunchMeetings(calendar),
    (async () => {
      try {
        const brief = await llm.generateBrief({ calendar, emails, uspsScans });
        log.info('Brief generated, sending to Telegram');
        await delivery.sendToTelegram(brief);
        briefResult = brief;
        log.info('Morning brief delivered');
      } catch (err) {
        if (!(err instanceof ActivityFailure)) throw err;
        log.error(`Brief generation failed, skipping: ${err.message}`);
      }
    })(),
  ]);

  if (lunchMeetings.length > 0) {
    log.info(`Found ${lunchMeetings.length} lunch meeting(s), setting up reminders`);
    await sendLunchReminders(lunchMeetings, () => stopped);
  }

  log.info('Morning brief workflow complete');
  return briefResult ?? '';
}

async function sendLunchReminders(meetings: activities.LunchMeeting[], isStopped: () => boolean): Promise<void> {

  for (const meeting of meetings) {
    if (isStopped()) break;

    // Build today's meeting timestamp
    const now = new Date(Date.now());
    const meetingTime = new Date(now);
    meetingTime.setHours(meeting.startHour, meeting.startMinute, 0, 0);
    const meetingMs = meetingTime.getTime();

    // --- 30-minute reminder ---
    const thirtyMinBefore = meetingMs - 30 * 60 * 1000;
    let waitMs = thirtyMinBefore - Date.now();

    if (waitMs > 0) {
      const wasStoppedEarly = await condition(isStopped, waitMs);
      if (wasStoppedEarly) break;
    }

    if (!isStopped() && Date.now() < meetingMs) {
      await delivery.sendToTelegram(
        `⏰ *30 min reminder:* ${meeting.title}\n\n_Reply STOP to cancel reminders._`,
      );
      log.info(`Sent 30-min reminder for: ${meeting.title}`);
    }

    // --- 10-minute reminder ---
    const tenMinBefore = meetingMs - 10 * 60 * 1000;
    waitMs = tenMinBefore - Date.now();

    if (waitMs > 0) {
      const wasStoppedEarly = await condition(isStopped, waitMs);
      if (wasStoppedEarly) break;
    }

    if (!isStopped() && Date.now() < meetingMs) {
      await delivery.sendToTelegram(
        `⏰ *10 min reminder:* ${meeting.title}`,
      );
      log.info(`Sent 10-min reminder for: ${meeting.title}`);
    }
  }
}
