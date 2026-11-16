import { env } from '../../config/env.js';
import { createLogger } from '../../utils/logger.js';
import { toErrorMessage } from '../../utils/errors.js';
import type { RawTikTokItem } from '../../types/scraper.js';

const logger = createLogger('playwright');

const DEFAULT_TARGETS = [
  'https://www.tiktok.com/search?q=tiktok%20shop',
  'https://www.tiktok.com/explore',
];

const MAX_SCROLL_ROUNDS = 6;
const SCROLL_DELAY_MS = 1_800;

interface CapturedProduct {
  id?: string;
  title?: string;
  price?: number | string;
  sold?: number | string;
  cover?: string;
  image_url?: string;
  shop_name?: string;
  shop_id?: string;
  url?: string;
  [key: string]: unknown;
}

/**
 * Fallback cào dữ liệu trực tiếp bằng Playwright khi Apify không khả dụng.
 * Bắt các response JSON nội bộ của TikTok (API search/explore/product) rồi
 * chuẩn hoá thành RawTikTokItem để dùng chung pipeline ingestion.
 */
export async function fetchTikTokItemsViaPlaywright(): Promise<RawTikTokItem[]> {
  const { chromium } = await import('playwright');

  const browser = await chromium.launch({
    headless: env.scrape.playwrightHeadless,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-setuid-sandbox'],
  });

  const collected = new Map<string, RawTikTokItem>();

  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 768 },
      locale: 'vi-VN',
    });

    const page = await context.newPage();

    page.on('response', (response) => {
      void captureResponse(response, collected);
    });

    for (const target of DEFAULT_TARGETS) {
      try {
        await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60_000 });

        for (let round = 0; round < MAX_SCROLL_ROUNDS; round += 1) {
          await page.evaluate((height: number) => {
            (globalThis as unknown as { scrollBy: (x: number, y: number) => void }).scrollBy(0, height);
          }, 800);
          await page.waitForTimeout(SCROLL_DELAY_MS);
        }
      } catch (error) {
        logger.warn(`Không thể cào ${target}: ${toErrorMessage(error)}`);
      }

      if (collected.size > 0) break;
    }

    const items = Array.from(collected.values());
    logger.info(`Playwright thu được ${items.length} bản ghi`);

    return items;
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function captureResponse(
  response: import('playwright').Response,
  collected: Map<string, RawTikTokItem>,
): Promise<void> {
  try {
    const url = response.url();
    const isCandidate =
      /\/api\/(search|explore|shop|product|recommend)/i.test(url) || /ecom|webapp\/search/i.test(url);

    if (!isCandidate) return;

    const contentType = response.headers()['content-type'] ?? '';
    if (!contentType.includes('application/json')) return;

    const payload = (await response.json()) as Record<string, any>;
    const candidates = extractCandidates(payload);

    for (const candidate of candidates) {
      const normalized = toRawItem(candidate);
      if (!normalized) continue;

      const key = String(normalized.id ?? normalized.webVideoUrl ?? normalized.text);
      if (!collected.has(key)) collected.set(key, normalized);
    }
  } catch {
    // Bỏ qua response không parse được.
  }
}

function extractCandidates(payload: Record<string, any>): CapturedProduct[] {
  const buckets = [
    payload?.data?.products,
    payload?.data?.items,
    payload?.data?.item_list,
    payload?.data?.itemList,
    payload?.product_list,
    payload?.itemList,
    payload?.item_list,
    payload?.products,
    payload?.data,
  ];

  for (const bucket of buckets) {
    if (Array.isArray(bucket) && bucket.length > 0) {
      return bucket.filter((item) => item && typeof item === 'object') as CapturedProduct[];
    }
  }

  return [];
}

function toRawItem(item: CapturedProduct): RawTikTokItem | null {
  const source = item as Record<string, any>;
  const stats = (source.stats ?? {}) as Record<string, any>;

  const title = String(source.title ?? source.desc ?? source.name ?? '').trim();
  if (title.length < 3) return null;

  const id = source.id ?? source.aweme_id ?? source.product_id ?? source.video_id;

  return {
    id: id === undefined || id === null ? undefined : String(id),
    text: title,
    webVideoUrl: typeof source.url === 'string' ? source.url : undefined,
    coverUrl: source.image_url ?? source.cover ?? source.coverUrl,
    playCount: (source.playCount ?? stats.playCount ?? source.views ?? 0) as number,
    diggCount: (source.diggCount ?? stats.diggCount ?? source.likes ?? 0) as number,
    shareCount: (source.shareCount ?? stats.shareCount ?? source.shares ?? 0) as number,
    commentCount: (source.commentCount ?? stats.commentCount ?? source.comments ?? 0) as number,
    price: (source.price ?? source.market_price ?? 0) as number,
    soldCount: (source.sold ?? source.sales ?? source.sold_count ?? 0) as number,
    shopName: (source.shop_name ?? source.seller_name) as string | undefined,
    shopId: (source.shop_id ?? source.seller_id) as string | undefined,
    searchQuery: 'playwright-fallback',
  };
}
