import { env } from '../../config/env.js';
import { createLogger } from '../../utils/logger.js';
import { toErrorMessage } from '../../utils/errors.js';
import { toOptionalBigInt } from '../../utils/numbers.js';
import { toBucketDate } from '../../utils/dates.js';
import prisma from '../../config/db.js';
import { runActorAndFetchItems, safelyFilterItems } from './apifyCore.js';

const logger = createLogger('shop-trend-videos');

interface RawTrendVideo {
  id?: string | number;
  aweme_id?: string | number;
  text?: string;
  desc?: string;
  webVideoUrl?: string;
  coverUrl?: string;
  videoMeta?: { coverUrl?: string; originalCoverUrl?: string };
  covers?: string[] | { default?: string; origin?: string };
  playCount?: number | string;
  diggCount?: number | string;
  shareCount?: number | string;
  commentCount?: number | string;
  authorMeta?: { name?: string; nickName?: string };
  searchQuery?: string;
  errorCode?: string;
  [key: string]: unknown;
}

export interface TrendVideoRecord {
  platformVideoId: string;
  content: string;
  author: string | null;
  videoUrl: string | null;
  coverUrl: string | null;
  playCount: bigint | null;
  diggCount: bigint | null;
  shareCount: bigint | null;
  commentCount: bigint | null;
  productId: number | null;
  shopId: number | null;
  bucketDate: Date;
}

/**
 * Cào Top Trend Video GẮN VỚI SẢN PHẨM/SHOP TikTok Shop.
 *
 * Nguyên tắc: chỉ tìm video theo từ khoá sản phẩm thương mại đã có trong DB
 * (không cào hashtag giải trí). Video được gắn productId/shopId khi tên hoặc
 * nội dung khớp với sản phẩm/shop tương ứng.
 */
export async function fetchCommerceTrendVideos(limit = 50): Promise<{
  saved: number;
  found: number;
  failures: string[];
}> {
  if (!env.apify.token) {
    return { saved: 0, found: 0, failures: ['APIFY_TOKEN chưa cấu hình'] };
  }

  // Từ khoá lấy từ chính sản phẩm VN đang có — đảm bảo ngữ cảnh thương mại.
  const products = await prisma.product.findMany({
    where: { region: 'VN' },
    orderBy: [{ soldCount: 'desc' }, { lastSeenAt: 'desc' }],
    take: Math.max(1, Math.min(limit, 50)),
    select: {
      id: true,
      title: true,
      productUrl: true,
      productShops: {
        where: { isActive: true },
        orderBy: { lastSeenAt: 'desc' },
        take: 1,
        select: { shopId: true },
      },
    },
  });

  if (products.length === 0) {
    return { saved: 0, found: 0, failures: ['Chưa có sản phẩm VN nào để tìm trend video'] };
  }

  const queries = buildProductQueries(products.map((product) => product.title));
  const failures: string[] = [];
  const records: TrendVideoRecord[] = [];

  const result = await runActorAndFetchItems({
    actorId: env.apify.actorId,
    input: {
      searchQueries: queries,
      searchSection: 'video',
      resultsPerPage: Math.max(5, Math.min(limit, 10)),
      proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'], apifyProxyCountry: 'VN' },
      shouldDownloadVideos: false,
      shouldDownloadCovers: false,
      shouldDownloadSubtitles: false,
      scrapeComments: false,
      proxyCountryCode: 'VN',
    },
    timeoutSecs: env.apify.timeoutSecs,
    label: 'shop-trend-videos',
    maxAttempts: env.apify.maxAttempts,
    // Ngân sách cứng cho dataset video — không tải quá 10 item.
    maxItems: Math.min(limit, 10),
  });

  const usable = safelyFilterItems(
    result.items,
    (item) => {
      const raw = item as unknown as RawTrendVideo;
      return !raw.errorCode && Boolean(raw.id ?? raw.aweme_id);
    },
    'trend-videos',
  );

  const productIndex = products.map((product) => ({
    id: product.id,
    shopId: product.productShops[0]?.shopId ?? null,
    title: normalize(product.title),
  }));

  for (const entry of usable) {
    const raw = entry.item as unknown as RawTrendVideo;
    const platformVideoId = String(raw.id ?? raw.aweme_id ?? '').trim();
    if (!platformVideoId) continue;

    const content = String(raw.text ?? raw.desc ?? '').trim();
    if (!content) continue;

    const matched = matchProduct(content, productIndex);

    records.push({
      platformVideoId,
      content,
      author: raw.authorMeta?.nickName ?? raw.authorMeta?.name ?? null,
      videoUrl: typeof raw.webVideoUrl === 'string' ? raw.webVideoUrl : null,
      coverUrl: extractCover(raw),
      playCount: toOptionalBigInt(raw.playCount),
      diggCount: toOptionalBigInt(raw.diggCount),
      shareCount: toOptionalBigInt(raw.shareCount),
      commentCount: toOptionalBigInt(raw.commentCount),
      productId: matched?.id ?? null,
      shopId: matched?.shopId ?? null,
      bucketDate: toBucketDate(new Date()),
    });
  }

  let saved = 0;
  for (const record of records) {
    try {
      await prisma.trendItem.upsert({
        where: { platformVideoId: record.platformVideoId },
        update: {
          content: record.content,
          author: record.author,
          videoUrl: record.videoUrl,
          coverUrl: record.coverUrl,
          playCount: record.playCount,
          diggCount: record.diggCount,
          shareCount: record.shareCount,
          commentCount: record.commentCount,
          productId: record.productId,
          shopId: record.shopId,
          bucketDate: record.bucketDate,
          scrapedAt: new Date(),
        },
        create: {
          platformVideoId: record.platformVideoId,
          content: record.content,
          author: record.author,
          videoUrl: record.videoUrl,
          coverUrl: record.coverUrl,
          playCount: record.playCount,
          diggCount: record.diggCount,
          shareCount: record.shareCount,
          commentCount: record.commentCount,
          productId: record.productId,
          shopId: record.shopId,
          bucketDate: record.bucketDate,
        },
      });
      saved += 1;
    } catch (error) {
      if (failures.length < 5) failures.push(toErrorMessage(error));
    }
  }

  logger.info(`Trend video thương mại: ${saved}/${records.length} lưu thành công`);
  return { saved, found: records.length, failures };
}

function extractCover(raw: RawTrendVideo): string | null {
  if (typeof raw.coverUrl === 'string' && raw.coverUrl.trim()) return raw.coverUrl.trim();
  if (raw.videoMeta) {
    const meta = raw.videoMeta;
    if (typeof meta.coverUrl === 'string' && meta.coverUrl.trim()) return meta.coverUrl.trim();
    if (typeof meta.originalCoverUrl === 'string' && meta.originalCoverUrl.trim()) return meta.originalCoverUrl.trim();
  }
  if (Array.isArray(raw.covers)) {
    const first = raw.covers.find((entry) => typeof entry === 'string' && entry.trim());
    if (typeof first === 'string') return first.trim();
  } else if (raw.covers && typeof raw.covers === 'object') {
    const cover = raw.covers;
    if (typeof cover.default === 'string' && cover.default.trim()) return cover.default.trim();
    if (typeof cover.origin === 'string' && cover.origin.trim()) return cover.origin.trim();
  }
  return null;
}

function buildProductQueries(titles: readonly string[]): string[] {
  const queries = new Set<string>();
  for (const title of titles) {
    const tokens = normalize(title).split(' ').filter((token) => token.length >= 3).slice(0, 4);
    if (tokens.length >= 2) queries.add(tokens.join(' '));
    if (queries.size >= 12) break;
  }
  return [...queries];
}

function matchProduct(
  content: string,
  products: Array<{ id: number; shopId: number | null; title: string }>,
): { id: number; shopId: number | null } | null {
  const text = normalize(content);
  for (const product of products) {
    const tokens = product.title.split(' ').filter((token) => token.length >= 4);
    if (tokens.length === 0) continue;
    const hits = tokens.filter((token) => text.includes(token)).length;
    if (hits >= Math.min(2, tokens.length)) return { id: product.id, shopId: product.shopId };
  }
  return null;
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
