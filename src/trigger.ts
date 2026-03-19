import { Client, Connection } from '@temporalio/client';

async function run() {
  const connection = await Connection.connect();
  const client = new Client({ connection });

  const workflowId = `morning-brief-${new Date().toISOString().slice(0, 10)}`;

  const handle = await client.workflow.start('morningBriefWorkflow', {
    taskQueue: 'morning-brief',
    workflowId,
  });

  console.log(`Started workflow: ${handle.workflowId}`);

  // Poll for the brief via query instead of waiting for the full workflow
  // (the workflow stays running for lunch reminders)
  let brief: string | null = null;
  while (!brief) {
    await new Promise((r) => setTimeout(r, 2_000));
    brief = await handle.query<string | null>('getBrief');
  }

  console.log(brief);
}

run().catch((err) => {
  console.error('Failed to trigger workflow:', err);
  process.exit(1);
});
