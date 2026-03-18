import { proxyActivities, log } from '@temporalio/workflow';
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

export async function morningBriefWorkflow(): Promise<string> {
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

  log.info('Morning brief delivered');
  return brief;
}
