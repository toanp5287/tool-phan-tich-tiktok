/** Idempotently generate isolated synthetic shops/creators and histories. */
import { datasetDb, datasetPool, verifyDatasetDatabase } from '../config/datasetDb.js';
import { generateSyntheticEntityHistory } from '../services/simulation/syntheticHistoryService.js';

async function main(): Promise<void> {
  await verifyDatasetDatabase();
  const rawDays = Number.parseInt(process.argv[2] ?? '90', 10);
  const days = Number.isSafeInteger(rawDays) && rawDays >= 7 && rawDays <= 365 ? rawDays : 90;
  const result = await generateSyntheticEntityHistory(days);
  process.stdout.write(JSON.stringify({ days, ...result }) + '\n');
}

main()
  .catch((error) => {
    process.stderr.write(String(error?.stack ?? error) + '\n');
    process.exitCode = 1;
  })
  .finally(async () => {
    await datasetDb.$disconnect();
    await datasetPool.end();
  });
