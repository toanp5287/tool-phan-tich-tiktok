import { ApifyClient } from 'apify';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';
import { createLogger } from '../../utils/logger.js';
import { isRetryableError, RetryableError, sleep, withRetry } from '../../utils/retry.js';
import type { RawTikTokItem } from '../../types/scraper.js';

const logger = createLogger('apify-core');

let cachedClient: ApifyClient | null = null;

export function getApifyClient(): ApifyClient {
  if (!env.apify.token) {
    throw new AppError(
      'Chưa cấu hình APIFY_TOKEN. Thêm token vào file .env để bật chế độ thu thập qua Apify.',
      503,
      'APIFY_NOT_CONFIGURED',
    );
  }

  cachedClient ??= new ApifyClient({ token: env.apify.token });
  return cachedClient;
}

export interface RunActorOptions {
  actorId: string;
  input: Record<string, unknown>;
  timeoutSecs: number;
  label?: string;
  maxAttempts?: number;
}

/**
 * Chạy Actor với retry: lỗi mạng, rate limit và dataset rỗng đều được thử lại.
 * Trả về run object của Apify.
 */
export async function runActorWithRetry(options: RunActorOptions) {
  if (
    env.scrape.shopOnly &&
    !['memo23/tiktok-shop-scraper', 'clockworks/tiktok-user-search-scraper'].includes(options.actorId.trim().toLowerCase())
  ) {
    throw new AppError(`Actor ${options.actorId} is disabled in Shop-only mode to enforce approved sources and monthly budget.`, 403, 'APIFY_ACTOR_NOT_ALLOWED');
  }

  const client = getApifyClient();
  const label = options.label ?? `actor:${options.actorId}`;

  return withRetry(
    async (attempt) => {
      logger.info(`[${label}] Lần thử ${attempt}: khởi chạy actor ${options.actorId}`);
      const run = await client.actor(options.actorId).call(options.input, { waitSecs: options.timeoutSecs });

      if (!run.defaultDatasetId) {
        throw new RetryableError(`Actor ${options.actorId} không trả về datasetId (lần thử ${attempt})`);
      }

      return run;
    },
    {
      maxAttempts: options.maxAttempts ?? env.apify.maxAttempts,
      minDelayMs: env.apify.retryDelayMinMs,
      maxDelayMs: env.apify.retryDelayMaxMs,
      label,
      isRetryable: isRetryableError,
    },
  );
}

export interface FetchDatasetOptions {
  label?: string;
  chunkSize?: number;
  maxItems?: number;
}

/**
 * Tải item của dataset, phân trang và retry theo từng trang.
 *
 * Tôn trọng `maxItems` tuyệt đối: dừng tải ngay khi đủ số lượng cần, nhờ đó
 * không kéo thêm dữ liệu (và không tốn thêm băng thông/thời gian) ngoài ngân sách.
 * Item không phải object sẽ bị loại bỏ (dữ liệu rác từ actor).
 */
export async function fetchDatasetItems(
  client: ApifyClient,
  datasetId: string,
  options: FetchDatasetOptions = {},
): Promise<RawTikTokItem[]> {
  const maxItems = Math.max(1, Math.trunc(options.maxItems ?? 100_000));
  const chunkSize = Math.max(1, Math.min(options.chunkSize ?? maxItems, maxItems, 5000));
  const label = options.label ?? 'dataset';

  const items: RawTikTokItem[] = [];
  let offset = 0;
  let malformed = 0;

  while (items.length < maxItems) {
    const remaining = maxItems - items.length;
    const limit = Math.min(chunkSize, remaining);

    const page = await withRetry(
      async () => client.dataset(datasetId).listItems({ offset, limit }),
      {
        maxAttempts: env.apify.maxAttempts,
        minDelayMs: env.apify.retryDelayMinMs,
        maxDelayMs: env.apify.retryDelayMaxMs,
        label: `${label}:page@${offset}`,
      },
    );

    const pageItems = (page.items ?? []) as unknown[];

    for (const rawItem of pageItems) {
      if (items.length >= maxItems) break;
      if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
        malformed += 1;
        continue;
      }
      items.push(rawItem as RawTikTokItem);
    }

    if (pageItems.length < limit) break;
    offset += pageItems.length;
  }

  if (malformed > 0) {
    logger.warn(`[${label}] Đã bỏ qua ${malformed} item không hợp lệ (không phải object)`);
  }
  if (items.length >= maxItems) {
    logger.info(`[${label}] Đã đạt ngân sách ${maxItems} item, dừng tải dataset`);
  }

  return items;
}

/**
 * Chạy actor và tải dataset, đảm bảo có dữ liệu: nếu dataset rỗng sẽ thử lại toàn bộ
 * (actor + tải dataset) tối đa `maxAttempts` lần.
 */
export async function runActorAndFetchItems(
  options: RunActorOptions & FetchDatasetOptions,
): Promise<{ items: RawTikTokItem[]; runId: string; datasetId: string; attempts: number }> {
  const client = getApifyClient();

  return withRetry(
    async (attempt) => {
      const run = await runActorWithRetry({ ...options, maxAttempts: 1 });
      const datasetId = run.defaultDatasetId as string;
      const items = await fetchDatasetItems(client, datasetId, options);

      if (items.length === 0) {
        throw new RetryableError(
          `[${options.label ?? options.actorId}] Actor trả về 0 bản ghi (lần thử ${attempt}/${options.maxAttempts ?? env.apify.maxAttempts})`,
        );
      }

      return { items, runId: run.id, datasetId, attempts: attempt };
    },
    {
      maxAttempts: options.maxAttempts ?? env.apify.maxAttempts,
      minDelayMs: env.apify.retryDelayMinMs,
      maxDelayMs: env.apify.retryDelayMaxMs,
      label: options.label ?? `actor-fetch:${options.actorId}`,
      onRetry: ({ attempt, delayMs, error }) => {
        logger.warn(
          `[${options.label ?? options.actorId}] Lần ${attempt} không có dữ liệu (${String(error)}). Chờ ${Math.round(delayMs / 1000)}s...`,
        );
      },
    },
  );
}

export interface SafeItemResult {
  item: RawTikTokItem;
  index: number;
}

/**
 * Lọc item an toàn từng bản ghi. Bọc mỗi item trong try/catch để 1 bản ghi lỗi
 * không làm hỏng cả chu kỳ cào.
 */
export function safelyFilterItems(
  items: readonly unknown[],
  validate: (item: RawTikTokItem) => boolean = () => true,
  label = 'items',
): SafeItemResult[] {
  const results: SafeItemResult[] = [];
  let dropped = 0;

  for (let index = 0; index < items.length; index += 1) {
    try {
      const item = items[index];
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        dropped += 1;
        continue;
      }
      const typed = item as RawTikTokItem;
      if (!validate(typed)) {
        dropped += 1;
        continue;
      }
      results.push({ item: typed, index });
    } catch (error) {
      dropped += 1;
      logger.warn(`[${label}] Bỏ qua item #${index}: ${String(error)}`);
    }
  }

  if (dropped > 0) logger.warn(`[${label}] Tổng cộng bỏ qua ${dropped}/${items.length} item không hợp lệ`);
  return results;
}

export { sleep };
