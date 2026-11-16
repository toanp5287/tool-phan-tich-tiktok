import { disconnectDatabase } from '../config/db.js';
import { runEchoTikGroupSync } from '../services/echotik/echoTikGroupSync.js';

async function main(): Promise<void> {
  try {
    const result = await runEchoTikGroupSync('shops');
    console.log('EchoTik Shop ingestion result');
    console.log(`received: ${result.received}`);
    console.log(`created: ${result.created}`);
    console.log(`skipped: ${result.skipped}`);
    console.log(`failed: ${result.failed}`);
    console.log(`API requests used: ${result.requestsUsed}/${result.requestsMax}`);
    console.log(`Run: ${result.runId}, status: ${result.status}`);
    for (const error of result.errors) console.error(`error: ${error}`);
    if (result.failed > 0) process.exitCode = 1;
  } catch (error) {
    console.error(`EchoTik Shop ingestion stopped: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 1;
  } finally {
    await disconnectDatabase();
  }
}

await main();
