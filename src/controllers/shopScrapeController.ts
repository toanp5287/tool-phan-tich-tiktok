import type { Request, Response } from 'express';
import { sendSuccess } from '../utils/http.js';
import { AppError } from '../utils/errors.js';
import { env, HARD_MAX_ITEMS_PER_RUN } from '../config/env.js';
import { JOB_TRIGGER } from '../config/constants.js';
import { isShopScrapeRunning, runShopScrapePipeline } from '../services/shopScrapeService.js';
import { getTaskLockState } from '../services/scrapeTaskLock.js';
import { getProductGrowth, getShopGrowth, pickPrimaryGrowth, serializeGrowth, closestWindow } from '../services/growthService.js';
import { clampInt } from '../utils/numbers.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('shop-scrape-controller');

function assertAdmin(req: Request): void {
  if (!env.adminToken) return;
  const provided = req.header('x-admin-token') ?? '';
  if (provided !== env.adminToken) throw AppError.unauthorized('Token quản trị không hợp lệ');
}

/** POST /api/scrape/tiktok-shop — chạy pipeline TikTok Shop (không cào mạng xã hội). */
export async function triggerShopScrape(req: Request, res: Response): Promise<void> {
  assertAdmin(req);

  if (isShopScrapeRunning()) {
    throw AppError.conflict('Một phiên cào TikTok Shop đang chạy. Vui lòng thử lại sau.');
  }

  const rawKeywords = req.query.keywords;
  const keywords =
    typeof rawKeywords === 'string'
      ? rawKeywords
          .split(',')
          .map((keyword) => keyword.trim())
          .filter(Boolean)
      : undefined;

  // Ép trần ngân sách: client không thể yêu cầu vượt 30 sản phẩm.
  const productsPerSearch = clampInt(
    req.query.productsPerSearch,
    1,
    HARD_MAX_ITEMS_PER_RUN,
    env.apify.shopProductsPerSearch,
  );
  const maxItems = clampInt(req.query.maxItems, 1, HARD_MAX_ITEMS_PER_RUN, env.apify.shopMaxItemsPerRun);

  void runShopScrapePipeline({ trigger: JOB_TRIGGER.API, keywords, productsPerSearch, maxItems })
    .then((result) => logger.info('Phiên cào TikTok Shop hoàn tất', result))
    .catch((error) => logger.error('Phiên cào TikTok Shop thất bại', error));

  res.status(202).json({
    success: true,
    data: {
      message: 'Đã khởi chạy phiên cào TikTok Shop. Theo dõi tiến trình qua /api/jobs.',
      actor: env.apify.shopActorId,
      keywords: keywords ?? env.apify.shopKeywords,
      maxItems,
      hardCap: HARD_MAX_ITEMS_PER_RUN,
    },
  });
}

/** GET /api/scrape/tiktok-shop/status */
export async function getShopScrapeStatus(_req: Request, res: Response): Promise<void> {
  const lock = getTaskLockState();

  sendSuccess(res, {
    running: isShopScrapeRunning(),
    taskLock: {
      isRunning: lock.isRunning,
      runId: lock.runId,
      startedAt: lock.startedAt ? new Date(lock.startedAt).toISOString() : null,
      trigger: lock.trigger,
      currentCycle: lock.currentCycle,
    },
    config: {
      actor: env.apify.shopActorId,
      keywords: env.apify.shopKeywords,
      maxItemsPerRun: env.apify.shopMaxItemsPerRun,
      hardCap: HARD_MAX_ITEMS_PER_RUN,
      productsPerSearch: env.apify.shopProductsPerSearch,
      region: env.apify.shopRegion,
      keywordsPerRun: env.apify.shopKeywordsPerRun,
      trendVideosPerRun: env.apify.shopTrendVideosPerRun,
      shopOnly: env.scrape.shopOnly,
      cron: env.scrape.shopCron,
      timezone: env.timezone,
      apifyConfigured: Boolean(env.apify.token),
      estimatedMaxCostUsd: estimateMaxCost(env.apify.shopMaxItemsPerRun),
    },
  });
}

/**
 * Ước tính chi phí tối đa cho 1 lần chạy dựa trên bảng giá công khai của
 * clockworks/tiktok-shop-scraper ($30/1000 sản phẩm ở gói Free, ~$13/1000 ở gói cao).
 * Dùng mức cao nhất để báo cáo an toàn.
 */
function estimateMaxCost(maxItems: number): number {
  const pricePerItem = 30 / 1000;
  return Math.round(maxItems * pricePerItem * 100) / 100;
}

/** GET /api/growth/products/:id?range=30d — xu hướng 1/7/30/90 ngày của sản phẩm. */
export async function getProductGrowthById(req: Request, res: Response): Promise<void> {
  const id = clampInt(req.params.id, 1, Number.MAX_SAFE_INTEGER, 0);
  if (!id) throw AppError.badRequest('ID sản phẩm không hợp lệ');

  const summary = await getProductGrowth(id);
  const windowDays = resolveWindowDays(req.query);
  sendSuccess(res, {
    productId: id,
    windowDays,
    primary: pickPrimaryGrowth(summary, windowDays),
    metrics: summary.metrics,
  });
}

/** GET /api/growth/shops/:id?range=30d — xu hướng 1/7/30/90 ngày của shop. */
export async function getShopGrowthById(req: Request, res: Response): Promise<void> {
  const id = clampInt(req.params.id, 1, Number.MAX_SAFE_INTEGER, 0);
  if (!id) throw AppError.badRequest('ID shop không hợp lệ');

  const summary = await getShopGrowth(id);
  const windowDays = resolveWindowDays(req.query);
  sendSuccess(res, {
    shopId: id,
    windowDays,
    primary: pickPrimaryGrowth(summary, windowDays),
    metrics: summary.metrics,
  });
}

function resolveWindowDays(query: Record<string, unknown>): number {
  const raw = typeof query.range === 'string' ? query.range.replace(/d$/i, '') : query.days;
  const parsed = clampInt(raw, 1, 365, 30);
  return closestWindow(parsed);
}
