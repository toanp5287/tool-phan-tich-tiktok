/**
 * Idempotent simulated 90-day history generation.
 * Chạy: node dist/scripts/simulateHistory.js [days]
 * Chỉ thêm snapshot SIMULATED; không ghi đè VERIFIED.
 */
import { datasetDb as db, datasetPool, verifyDatasetDatabase } from '../config/datasetDb.js';
import { captureSimulatedHistory } from '../services/snapshotService.js';

async function main(): Promise<void> {
  await verifyDatasetDatabase();
  const daysArg = Number.parseInt(process.argv[2] ?? '', 10);
  const days = Number.isFinite(daysArg) && daysArg >= 7 && daysArg <= 365 ? daysArg : 90;
  const report = await captureSimulatedHistory(days);
  process.stdout.write(JSON.stringify({ days, ...report }) + '\n');
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
