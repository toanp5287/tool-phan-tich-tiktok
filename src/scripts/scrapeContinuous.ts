import {
  isStopRequested,
  requestStop,
  resetContinuousScrapeState,
  runContinuousScrape,
  type ContinuousScrapeSummary,
} from '../services/continuousScrapeService.js';
import { disconnectDatabase } from '../config/db.js';
import { env } from '../config/env.js';
import { createLogger } from '../utils/logger.js';
import { formatDuration } from '../utils/dates.js';
import { toErrorMessage } from '../utils/errors.js';

const logger = createLogger('cli:scrape');

let shutdownHooked = false;

function installSignalHandlers(): void {
  if (shutdownHooked) return;
  shutdownHooked = true;

  const onSignal = (signal: string): void => {
    if (isStopRequested()) {
      logger.warn(`Nhận ${signal} lần hai — thoát ngay lập tức`);
      process.exit(130);
    }

    logger.warn(
      `Nhận ${signal} — sẽ dừng sau khi chu kỳ hiện tại hoàn tất (nhấn Ctrl + C lần nữa để thoát ngay)`,
    );
    requestStop();
  };

  process.on('SIGINT', () => onSignal('SIGINT'));
  process.on('SIGTERM', () => onSignal('SIGTERM'));
}

function printSummary(summary: ContinuousScrapeSummary): void {
  logger.info(`Tổng kết Continuous Scraping (dừng bởi: ${summary.stoppedBy})`, {
    thoiGian: formatDuration(summary.durationMs),
    soChuKy: summary.cycles,
    chuKyThanhCong: summary.completedCycles,
    chuKyThatBai: summary.failedCycles,
    banGhiMoi: summary.totalSaved,
    banGhiCapNhat: summary.totalUpdated,
    banGhiLoi: summary.totalFailed,
  });
}

async function main(): Promise<void> {
  resetContinuousScrapeState();
  installSignalHandlers();

  logger.info('Chế độ Continuous Scraping — chỉ dừng khi bạn nhấn Ctrl + C');
  logger.info(
    `Ngân sách mỗi chu kỳ: tối đa ${env.apify.shopMaxItemsPerRun} sản phẩm (trần cứng 30) | ` +
      'Nghỉ: SCRAPE_INTERVAL_SECS (mặc định 43200s = 12 giờ) | SCRAPE_MAX_CYCLES (0 = vô hạn)',
  );
  logger.info(
    'Task lock: nếu một tiến trình khác đang cào, chu kỳ này sẽ tự bỏ qua thay vì chạy song song.',
  );

  const summary = await runContinuousScrape();
  printSummary(summary);
}

main()
  .catch((error) => {
    logger.error(`Continuous Scraping thất bại: ${toErrorMessage(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDatabase();
  });
