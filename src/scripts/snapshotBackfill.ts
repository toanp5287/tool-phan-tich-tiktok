/**
 * Idempotent daily snapshot capture (baseline + real dated history backfill).
 * Chạy: node dist/scripts/snapshotBackfill.js
 */
import { datasetDb as db, datasetPool, verifyDatasetDatabase } from '../config/datasetDb.js';
import { runSnapshotCapture } from '../services/snapshotService.js';

async function main(): Promise<void> {
  await verifyDatasetDatabase();
  const report = await runSnapshotCapture();
  process.stdout.write(JSON.stringify(report) + '\n');
}

main()
  .catch((error) => {
    process.stderr.write(String(error?.stack ?? error) + '\n');
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
    await datasetPool.end();
  });
