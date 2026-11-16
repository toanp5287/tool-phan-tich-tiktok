/**
 * Idempotent linking/classification backfill over the existing dataset.
 * Chạy: node dist/scripts/linkBackfill.js  (sau khi build)
 * An toàn: không reset/truncate/xoá; chỉ thêm nhóm gần nghĩa cho bản ghi thiếu.
 */
import { datasetDb as db, datasetPool, verifyDatasetDatabase } from '../config/datasetDb.js';
import { runBackfill } from '../services/linking/linkingService.js';

async function main(): Promise<void> {
  await verifyDatasetDatabase();
  const report = await runBackfill();
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
