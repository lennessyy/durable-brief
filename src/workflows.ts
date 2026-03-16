import { proxyActivities, log } from '@temporalio/workflow';
import type * as activities from './activities';

const gog = proxyActivities<typeof activities>({
  startToCloseTimeout: '30s',
  retry: {
    maximumAttempts: 3,
    initialInterval: '5s',
    backoffCoefficient: 2,
  },
});

const llm = proxyActivities<typeof activities>({
  startToCloseTimeout: '60s',
  retry: {
    maximumAttempts: 3,
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
  const [calendar, gmail, usps, amazon] = await Promise.all([
    gog.fetchCalendar(),
    gog.fetchGmail(),
    gog.fetchUSPSEmails(),
    gog.fetchAmazonEmails(),
  ]);

  log.info('All data fetched, generating brief');

  // Generate the brief via LLM
  const brief = await llm.generateBrief({ calendar, gmail, usps, amazon });

  log.info('Brief generated, sending to Telegram');

  // Deliver to Telegram
  await delivery.sendToTelegram(brief);

  log.info('Morning brief delivered');
  return brief;
}
