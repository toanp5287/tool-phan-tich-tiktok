import { env, HARD_MAX_ITEMS_PER_RUN } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';
import { createLogger } from '../../utils/logger.js';
import { toErrorMessage } from '../../utils/errors.js';
import { chunk, sleep } from '../../utils/async.js';
import type { RawShopItem } from '../../types/shopScrape.js';
import { runActorAndFetchItems, safelyFilterItems } from './apifyCore.js';

const logger = createLogger('apify-shop');

/** Trần cứng số sản phẩm / lần chạy — không nhánh nào được vượt. */
export const MAX_ITEMS_PER_RUN = HARD_MAX_ITEMS_PER_RUN;

/** Giới hạn số lần thử lại batch (không retry vô hạn). */
const MAX_BATCH_ATTEMPTS = 1;

export interface ShopFetchOptions {
  keywords?: string[];
  productsPerSearch?: number;
  region?: string;
  timeoutSecs?: number;
  maxAttempts?: number;
  actorId?: string;
  categoryUrls?: string[];
  /** Trần sản phẩm cho lần gọi này (luôn bị ép <= MAX_ITEMS_PER_RUN). */
  maxItems?: number;
}

export interface ShopFetchResult {
  items: RawShopItem[];
  runId: string;
  datasetId: string;
  keywords: string[];
  attempts: number;
  /** Số bản ghi Actor trả về trước khi cắt theo ngân sách. */
  rawCount: number;
}

/** Item lỗi do Actor trả về (SHOP_QUERY_FAILED, ...) — không phải sản phẩm. */
export function isShopErrorItem(item: RawShopItem): boolean {
  return typeof item.errorCode === 'string' && item.errorCode.length > 0;
}

/** Sản phẩm hợp lệ tối thiểu: có ID hoặc tiêu đề. */
export function isUsableShopItem(item: RawShopItem): boolean {
  if (isShopErrorItem(item)) return false;
  const hasId = item.productId !== undefined && item.productId !== null && String(item.productId).trim() !== '';
  const hasTitle = typeof item.title === 'string' && item.title.trim().length >= 2;
  return hasId || hasTitle;
}

/**
 * Ép trần ngân sách: min(giá trị mong muốn, trần cứng 30).
 */
export function resolveBudget(requested?: number): number {
  const safe = Number.isFinite(requested) ? Math.trunc(requested as number) : MAX_ITEMS_PER_RUN;
  return Math.min(Math.max(1, safe), MAX_ITEMS_PER_RUN);
}

function normalizeKeywords(keywords: readonly string[]): string[] {
  return Array.from(
    new Set(
      keywords
        .map((keyword) => keyword.trim())
        .filter((keyword) => keyword.length > 0),
    ),
  );
}

/** Actor mặc định hỗ trợ VN. */
export const DEFAULT_SHOP_ACTOR = 'memo23/tiktok-shop-scraper';

/** Actor chỉ hỗ trợ US — cần cảnh báo nếu người dùng cấu hình nhầm. */
const US_ONLY_ACTORS = ['clockworks/tiktok-shop-scraper'];

export function isUsOnlyActor(actorId: string): boolean {
  return US_ONLY_ACTORS.some((id) => actorId.toLowerCase().includes(id));
}

export function isMemo23Actor(actorId: string): boolean {
  return actorId.toLowerCase().includes('memo23');
}

/**
 * Xây input Actor theo đúng schema.
 *
 * - `memo23/tiktok-shop-scraper` (mặc định): hỗ trợ `region: 'VN'`, trả
 *   `relatedVideos` (video bán sản phẩm) trong cùng run — không tốn thêm credit.
 * - `clockworks/tiktok-shop-scraper`: chỉ US; vẫn hỗ trợ nếu người dùng tự chọn.
 *
 * `perSearch` được chia theo ngân sách để tổng sản phẩm Actor scrape <= budget.
 */
function buildActorInput(
  keywords: string[],
  options: ShopFetchOptions,
  budget: number,
): Record<string, unknown> {
  const region = 'VN';
  const actorId = DEFAULT_SHOP_ACTOR;

  const keywordCount = Math.max(1, keywords.length);
  const budgetPerKeyword = Math.max(1, Math.ceil(budget / keywordCount));
  const requestedPerSearch = Number.isFinite(options.productsPerSearch)
    ? Math.max(1, Math.trunc(options.productsPerSearch as number))
    : budgetPerKeyword;
  const perSearch = Math.min(requestedPerSearch, budgetPerKeyword, MAX_ITEMS_PER_RUN);

  if (isMemo23Actor(actorId)) {
    return {
      keywords,
      // `region` là tên trường chính thức của memo23; `country` được gửi kèm
      // như bí danh để tương thích các bản Actor/phiên bản đọc `country`.
      region,
      country: region,
      countryCode: region,
      maxProductsPerKeyword: perSearch,
      // Trần cứng cho toàn run.
      maxItems: budget,
      // Best-sellers của thị trường VN — cùng run, không thêm chi phí.
      includeBestSellers: env.apify.shopIncludeBestSellers,
      maxBestSellers: env.apify.shopBestSellersCount,
      // Request full available product/shop fields; the Actor may still return
      // listing-only rows for markets where TikTok limits detail access.
      includeDetails: true,
      includeReviews: false,
      includeSalesTrend: false,
      maxConcurrency: 5,
    };
  }

  // clockworks & actor tương thích
  const categoryUrls = (options.categoryUrls ?? env.apify.shopCategoryUrls).filter(Boolean);
  return {
    keywords,
    productsPerSearch: perSearch,
    maxProductsPerKeyword: perSearch,
    maxItems: budget,
    maxProducts: budget,
    categoryUrls,
    countryCode: region,
    region,
    proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'], apifyProxyCountry: region },
    shouldDownloadVideos: false,
    shouldDownloadCovers: false,
  };
}

/**
 * Gọi Actor TikTok Shop cho một batch từ khoá với ngân sách cứng.
 *
 * - Input gửi `maxItems` + `productsPerSearch` đã ép <= 30.
 * - Dataset tải về bị cắt `items.slice(0, budget)` trước khi trả ra ngoài,
 *   kể cả khi Actor trả về nhiều hơn.
 * - Retry có giới hạn (`env.apify.maxAttempts`), mỗi lần cách nhau `sleep`.
 */
export async function fetchShopItems(options: ShopFetchOptions = {}): Promise<ShopFetchResult> {
  const keywords = normalizeKeywords(options.keywords ?? env.apify.shopKeywords);
  if (keywords.length === 0) {
    throw new AppError('Danh sách từ khoá TikTok Shop rỗng, không thể gọi Apify Actor.', 400, 'EMPTY_SHOP_KEYWORDS');
  }

  const budget = resolveBudget(options.maxItems);
  const actorId = DEFAULT_SHOP_ACTOR;
  if (options.actorId && options.actorId !== DEFAULT_SHOP_ACTOR) {
    logger.warn(`Ignoring actor override ${options.actorId}; strict mode requires ${DEFAULT_SHOP_ACTOR}`);
  }
  const input = buildActorInput(keywords, options, budget);

  if (isUsOnlyActor(actorId) && (options.region ?? env.apify.shopRegion).toUpperCase() === 'VN') {
    logger.warn(
      `Actor "${actorId}" CHỈ hỗ trợ thị trường US — sẽ không trả dữ liệu VN. ` +
        `Đổi APIFY_SHOP_ACTOR sang "${DEFAULT_SHOP_ACTOR}" để cào TikTok Shop Việt Nam.`,
    );
  }

  logger.info(`Gọi Apify TikTok Shop actor ${actorId} (ngân sách tối đa ${budget} sản phẩm)`, {
    keywords: keywords.length,
    perSearch: input.productsPerSearch ?? input.maxProductsPerKeyword,
    maxItems: budget,
    region: input.region,
  });

  const result = await runActorAndFetchItems({
    actorId,
    input,
    timeoutSecs: options.timeoutSecs ?? env.apify.timeoutSecs,
    label: 'tiktok-shop',
    // Never repeat a paid product run automatically.
    maxAttempts: 1,
    maxItems: budget,
  });

  const errorItems = (result.items as unknown as RawShopItem[]).filter(isShopErrorItem);
  const verified = safelyFilterItems(result.items, (item) => isUsableShopItem(item as RawShopItem), 'shop-items');

  // Sản phẩm có thể nằm trong `product_list` (một số actor trả shop-level item).
  const expanded: RawShopItem[] = [];
  for (const entry of verified) {
    if (expanded.length >= budget) break;

    const item = entry.item as RawShopItem;
    if (Array.isArray(item.product_list) && item.product_list.length > 0) {
      for (const product of item.product_list) {
        if (expanded.length >= budget) break;
        if (product && typeof product === 'object') {
          expanded.push({ ...product, ...shopContextOf(item) });
        }
      }
      continue;
    }
    expanded.push(item);
  }

  // Cắt cứng lần cuối — bảo đảm không bao giờ vượt ngân sách.
  const items = expanded.slice(0, budget);

  if (errorItems.length > 0) {
    logger.warn(
      `Actor bỏ qua ${errorItems.length} từ khoá không có sản phẩm: ${errorItems
        .slice(0, 5)
        .map((item) => `${String(item.input ?? '?')} (${String(item.errorCode)})`)
        .join(', ')}`,
    );
  }

  logger.info(
    `TikTok Shop: Actor trả ${result.items.length} thô → lưu tối đa ${items.length}/${budget} sản phẩm`,
    { runId: result.runId, datasetId: result.datasetId, attempts: result.attempts },
  );

  return {
    items,
    runId: result.runId,
    datasetId: result.datasetId,
    keywords,
    attempts: result.attempts,
    rawCount: result.items.length,
  };
}

function shopContextOf(item: RawShopItem): Partial<RawShopItem> {
  return {
    shop_name: item.shop_name,
    shop_url: item.shop_url,
    shop_id: item.shop_id,
    follower_count: item.follower_count,
    total_products: item.total_products,
    average_rating: item.average_rating,
    rating_count: item.rating_count,
    currency: item.currency,
  };
}

/**
 * Chia danh sách từ khoá thành batch và gọi Actor tuần tự, tôn trọng ngân sách
 * tổng của cả lần chạy.
 *
 * - Dừng ngay khi đã đủ `maxItems` sản phẩm (không gọi thêm Actor => không tốn thêm credit).
 * - Mỗi batch tối đa `MAX_BATCH_ATTEMPTS` lần thử, có `sleep` giữa các lần.
 * - Lỗi 1 batch không làm hỏng cả chu kỳ.
 */
export async function fetchShopItemsBatched(options: ShopFetchOptions = {}): Promise<{
  items: RawShopItem[];
  keywords: string[];
  batches: number;
  failures: string[];
  rawCount: number;
  budget: number;
  budgetReached: boolean;
}> {
  const keywords = normalizeKeywords(options.keywords ?? env.apify.shopKeywords);
  const budget = resolveBudget(options.maxItems);

  /**
   * CHI PHÍ: mỗi batch = 1 Actor run. Với ngân sách nhỏ (≤30), gộp TẤT CẢ từ khoá
   * vào 1 lần gọi duy nhất để chỉ phát sinh 1 run và `perSearch` được chia đều,
   * nhờ đó tổng sản phẩm Actor scrape không vượt budget.
   */
  const batchSize = Math.max(keywords.length, Math.max(1, env.apify.shopKeywordsPerRun));
  const groups = chunk(keywords, batchSize);

  const collected: RawShopItem[] = [];
  const failures: string[] = [];
  let rawCount = 0;
  let batchesRun = 0;

  for (let index = 0; index < groups.length; index += 1) {
    if (collected.length >= budget) break;

    const group = groups[index] ?? [];
    if (group.length === 0) continue;

    // Chỉ xin đúng số còn thiếu — không đốt credit cho phần vượt ngân sách.
    const remaining = budget - collected.length;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= MAX_BATCH_ATTEMPTS; attempt += 1) {
      try {
        const result = await fetchShopItems({
          ...options,
          keywords: group,
          maxItems: remaining,
        });

        batchesRun += 1;
        rawCount += result.rawCount;
        collected.push(...result.items.slice(0, remaining));
        lastError = null;
        break;
      } catch (error) {
        lastError = error;

        if (attempt < MAX_BATCH_ATTEMPTS) logger.warn(`Batch ${index + 1} failed: ${toErrorMessage(error)}`);
      }
    }

    if (lastError !== null) {
      const message = `Batch ${index + 1}/${groups.length} [${group.join(', ')}]: ${toErrorMessage(lastError)}`;
      failures.push(message);
      logger.error(`Bỏ qua batch từ khoá TikTok Shop — ${message}`);
    }
  }

  return {
    items: collected.slice(0, budget),
    keywords,
    batches: batchesRun,
    failures,
    rawCount,
    budget,
    budgetReached: collected.length >= budget,
  };
}
