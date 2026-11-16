import nodeCron, { type ScheduledTask } from 'node-cron';
import { env } from '../config/env.js';
import { JOB_TRIGGER } from '../config/constants.js';
import { runScrapePipeline, isScrapeRunning } from './scrapeService.js';
import { runProfileScrapePipeline, isProfileScrapeRunning } from './profileScrapeService.js';
import { runCreativeScrapePipeline, isCreativeScrapeRunning } from './creativeScrapeService.js';
import { isShopScrapeRunning, runShopScrapePipeline } from './shopScrapeService.js';
import { closeStaleJobs } from './jobService.js';
import { syncCategoryCatalog } from './categoryCatalogService.js';
import { createLogger } from '../utils/logger.js';
import { toErrorMessage } from '../utils/errors.js';

const logger = createLogger('scheduler');

// ─── Full-sync scheduler (từ khoá ngẫu nhiên → cố định) ────────────────
let fullSyncTask: ScheduledTask | null = null;

// ─── Profile scheduler (Targeted Top Shops → Sprint 1) ─────────────────
let profileTask: ScheduledTask | null = null;

// ─── Creative Center scheduler (Creators/Affiliates) ───────────────────
let creativeTask: ScheduledTask | null = null;

// ─── TikTok Shop scheduler (nguồn dữ liệu chính) ───────────────────────
let shopTask: ScheduledTask | null = null;

// ─── TikTok Shop Scheduler ──────────────────────────────────────────────────

/**
 * Lịch cào TikTok Shop (mặc định mỗi 6 giờ).
 * Đây là nguồn dữ liệu duy nhất khi SCRAPE_SHOP_ONLY=true (mặc định).
 */
export function startShopScheduler(): void {
  if (!env.scrape.enabled) {
    logger.warn('Scheduler đã bị tắt qua SCRAPE_SCHEDULER_ENABLED=false');
    return;
  }

  if (!nodeCron.validate(env.scrape.shopCron)) {
    logger.error(`Biểu thức cron TikTok Shop không hợp lệ: "${env.scrape.shopCron}". Bỏ qua lịch tự động.`);
    return;
  }

  shopTask = nodeCron.schedule(
    env.scrape.shopCron,
    async () => {
      if (isShopScrapeRunning()) {
        logger.warn('Bỏ qua lượt cào TikTok Shop theo lịch vì phiên trước chưa kết thúc');
        return;
      }

      logger.info('Bắt đầu phiên cào TikTok Shop theo lịch');

      try {
        const result = await runShopScrapePipeline({ trigger: JOB_TRIGGER.CRON });
        logger.info(
          `Lịch TikTok Shop hoàn tất: ${result.saved} mới, ${result.updated} cập nhật, ${result.failed} lỗi (${result.durationMs}ms)`,
        );
      } catch (error) {
        logger.error('Phiên cào TikTok Shop theo lịch thất bại', toErrorMessage(error));
      }
    },
    { timezone: env.timezone, name: 'tiktok-shop-sync', noOverlap: true },
  );

  const nextRun = shopTask.getNextRun();
  logger.info(
    `[Shop-Sync] Đã lập lịch "${env.scrape.shopCron}" (${env.timezone})${nextRun ? ` - lần tới: ${nextRun.toISOString()}` : ''}`,
  );
}

export function getNextShopScheduledRun(): Date | null {
  return shopTask?.getNextRun() ?? null;
}

// ─── Full-Sync Scheduler (chỉ bật khi SCRAPE_SHOP_ONLY=false) ────────────────

export function startScheduler(): void {
  if (!env.scrape.enabled) {
    logger.warn('Scheduler đã bị tắt qua SCRAPE_SCHEDULER_ENABLED=false');
    return;
  }

  if (env.scrape.shopOnly) {
    logger.info('SCRAPE_SHOP_ONLY=true — bỏ qua Full-Sync mạng xã hội, chỉ cào TikTok Shop');
    return;
  }

  if (!nodeCron.validate(env.scrape.cron)) {
    logger.error(`Biểu thức cron không hợp lệ: "${env.scrape.cron}". Bỏ qua lịch tự động.`);
    return;
  }

  fullSyncTask = nodeCron.schedule(
    env.scrape.cron,
    async () => {
      if (isScrapeRunning()) {
        logger.warn('Bỏ qua lượt cào theo lịch vì phiên trước chưa kết thúc');
        return;
      }

      logger.info('Bắt đầu phiên cào tự động theo lịch (full-sync)');

      try {
        const result = await runScrapePipeline({ trigger: JOB_TRIGGER.CRON });
        logger.info(
          `Lịch tự động hoàn tất: ${result.saved} mới, ${result.updated} cập nhật, ${result.failed} lỗi (${result.durationMs}ms)`,
        );
      } catch (error) {
        logger.error('Phiên cào theo lịch thất bại', toErrorMessage(error));
      }
    },
    { timezone: env.timezone, name: 'tiktok-full-sync', noOverlap: true },
  );

  const nextRun = fullSyncTask.getNextRun();
  logger.info(
    `[Full-Sync] Đã lập lịch "${env.scrape.cron}" (${env.timezone})${nextRun ? ` - lần tới: ${nextRun.toISOString()}` : ''}`,
  );
}

// ─── Profile Scheduler (Sprint 1) ────────────────────────────────────────────

export function startProfileScheduler(): void {
  if (!env.scrape.enabled) return; // Dùng chung flag SCRAPE_SCHEDULER_ENABLED
  if (env.scrape.shopOnly) {
    logger.info('SCRAPE_SHOP_ONLY=true — bỏ qua Profile scheduler (mạng xã hội)');
    return;
  }

  if (!nodeCron.validate(env.scrape.profileCron)) {
    logger.error(
      `Biểu thức cron Profile không hợp lệ: "${env.scrape.profileCron}". Bỏ qua lịch Profile.`,
    );
    return;
  }

  profileTask = nodeCron.schedule(
    env.scrape.profileCron,
    async () => {
      if (isProfileScrapeRunning()) {
        logger.warn('Bỏ qua lượt cào Profile theo lịch vì phiên trước chưa kết thúc');
        return;
      }

      logger.info('Bắt đầu phiên cào Targeted Profiles theo lịch');

      try {
        const result = await runProfileScrapePipeline({ trigger: JOB_TRIGGER.CRON });
        logger.info(
          `[Profile] Hoàn tất: ${result.shopsQueued} shops, ${result.saved} mới, ${result.updated} cập nhật (${result.durationMs}ms)`,
        );
      } catch (error) {
        logger.error('Phiên cào Targeted Profiles theo lịch thất bại', toErrorMessage(error));
      }
    },
    { timezone: env.timezone, name: 'tiktok-profile-sync', noOverlap: true },
  );

  const nextRun = profileTask.getNextRun();
  logger.info(
    `[Profile-Sync] Đã lập lịch "${env.scrape.profileCron}" (${env.timezone})${nextRun ? ` - lần tới: ${nextRun.toISOString()}` : ''}`,
  );
}

// ─── Creative Center Scheduler (Creators/Affiliates) ─────────────────────────

export function startCreativeScheduler(): void {
  if (!env.scrape.enabled || !env.apify.creativeEnabled) return;
  if (env.scrape.shopOnly) {
    logger.info('SCRAPE_SHOP_ONLY=true — bỏ qua Creative Center scheduler (mạng xã hội)');
    return;
  }

  if (!nodeCron.validate(env.scrape.creativeCron)) {
    logger.error(
      `Biểu thức cron Creative Center không hợp lệ: "${env.scrape.creativeCron}". Bỏ qua lịch Creative.`,
    );
    return;
  }

  creativeTask = nodeCron.schedule(
    env.scrape.creativeCron,
    async () => {
      if (isCreativeScrapeRunning()) {
        logger.warn('Bỏ qua lượt cào Creative Center vì phiên trước chưa kết thúc');
        return;
      }

      logger.info('Bắt đầu phiên cào Creative Center theo lịch');

      try {
        const result = await runCreativeScrapePipeline({ trigger: JOB_TRIGGER.CRON });
        logger.info(
          `[Creative] Hoàn tất: ${result.creatorsSaved}/${result.creatorsFound} creators (${result.durationMs}ms)`,
        );
      } catch (error) {
        logger.error('Phiên cào Creative Center theo lịch thất bại', toErrorMessage(error));
      }
    },
    { timezone: env.timezone, name: 'tiktok-creative-sync', noOverlap: true },
  );

  const nextRun = creativeTask.getNextRun();
  logger.info(
    `[Creative-Sync] Đã lập lịch "${env.scrape.creativeCron}" (${env.timezone})${nextRun ? ` - lần tới: ${nextRun.toISOString()}` : ''}`,
  );
}

// ─── Stop ─────────────────────────────────────────────────────────────────────

export function stopScheduler(): void {
  if (fullSyncTask) {
    fullSyncTask.destroy();
    fullSyncTask = null;
    logger.info('Đã dừng Full-Sync scheduler');
  }
  if (profileTask) {
    profileTask.destroy();
    profileTask = null;
    logger.info('Đã dừng Profile scheduler');
  }
  if (creativeTask) {
    creativeTask.destroy();
    creativeTask = null;
    logger.info('Đã dừng Creative Center scheduler');
  }
  if (shopTask) {
    shopTask.destroy();
    shopTask = null;
    logger.info('Đã dừng TikTok Shop scheduler');
  }
}

// ─── Query next runs ──────────────────────────────────────────────────────────

export function getNextScheduledRun(): Date | null {
  return fullSyncTask?.getNextRun() ?? null;
}

export function getNextProfileScheduledRun(): Date | null {
  return profileTask?.getNextRun() ?? null;
}

export function getNextCreativeScheduledRun(): Date | null {
  return creativeTask?.getNextRun() ?? null;
}

// ─── Startup Tasks ────────────────────────────────────────────────────────────

export async function runStartupTasks(): Promise<void> {
  await closeStaleJobs();

  // Đồng bộ danh mục ngành hàng (idempotent) mỗi khi khởi động
  try {
    await syncCategoryCatalog();
  } catch (error) {
    logger.warn('Không thể đồng bộ danh mục ngành hàng khi khởi động', toErrorMessage(error));
  }

  if (env.scrape.runOnStartup && !env.scrape.shopOnly) {
    logger.info('SCRAPE_ON_STARTUP=true -> khởi chạy full-sync ngay khi server sẵn sàng');
    runScrapePipeline({ trigger: JOB_TRIGGER.STARTUP }).catch((error) => {
      logger.error('Đồng bộ full-sync lúc khởi động thất bại', toErrorMessage(error));
    });
  }

  if (env.scrape.profileRunOnStartup && !env.scrape.shopOnly) {
    logger.info('SCRAPE_PROFILE_ON_STARTUP=true -> khởi chạy Profile Scrape ngay khi server sẵn sàng');
    runProfileScrapePipeline({ trigger: JOB_TRIGGER.STARTUP }).catch((error) => {
      logger.error('Đồng bộ Profile lúc khởi động thất bại', toErrorMessage(error));
    });
  }

  if (env.scrape.shopRunOnStartup) {
    logger.info('SCRAPE_SHOP_ON_STARTUP=true -> khởi chạy cào TikTok Shop ngay khi server sẵn sàng');
    runShopScrapePipeline({ trigger: JOB_TRIGGER.STARTUP }).catch((error) => {
      logger.error('Đồng bộ TikTok Shop lúc khởi động thất bại', toErrorMessage(error));
    });
  }

  if (env.scrape.autoStartLoop) {
    logger.info('SCRAPE_AUTO_START_LOOP=true -> khởi động vòng lặp cào 24/7 trong tiến trình server');
    void startEmbeddedContinuousLoop();
  }
}

/**
 * Chạy vòng lặp cào liên tục ngay trong tiến trình Express.
 * Mặc định tắt để `npm run scrape` là cách chạy 24/7 chính; bật bằng
 * SCRAPE_AUTO_START_LOOP=true khi triển khai dạng một service duy nhất.
 */
async function startEmbeddedContinuousLoop(): Promise<void> {
  const { runContinuousScrape, resetContinuousScrapeState } = await import('./continuousScrapeService.js');

  resetContinuousScrapeState();

  try {
    await runContinuousScrape();
  } catch (error) {
    logger.error('Vòng lặp cào TikTok Shop trong server dừng do lỗi', toErrorMessage(error));
  }
}
