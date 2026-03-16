import { Client, Connection } from '@temporalio/client';

async function run() {
  const connection = await Connection.connect();
  const client = new Client({ connection });

  const handle = await client.workflow.start('morningBriefWorkflow', {
    taskQueue: 'morning-brief',
    workflowId: `morning-brief-${new Date().toISOString().slice(0, 10)}`,
  });

  console.log(`Started workflow: ${handle.workflowId}`);

  const result = await handle.result();
  console.log(result);
}

run().catch((err) => {
  console.error('Failed to trigger workflow:', err);
  process.exit(1);
});
