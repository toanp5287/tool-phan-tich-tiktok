import type {
  RawTikTokItem,
  ScrapedCreatorRecord,
  ScrapedProductRecord,
  ScrapedRecord,
  ScrapedRevenueBreakdown,
  ScrapedShopRecord,
} from '../../types/scraper.js';
import { toFiniteNumber, toOptionalNumber } from '../../utils/numbers.js';
import { classifyProduct } from '../../utils/classifier.js';
import { extractVariants } from '../../utils/variants.js';

const MIN_TITLE_LENGTH = 3;


function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function pickNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = toOptionalNumber(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function readPath(source: unknown, path: string): unknown {
  let cursor: unknown = source;
  for (const key of path.split('.')) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}

function extractImageUrl(item: RawTikTokItem): string | null {
  const covers = item.covers;
  if (Array.isArray(covers)) {
    const first = covers.find((cover) => typeof cover === 'string');
    if (typeof first === 'string') return first;
  } else if (covers && typeof covers === 'object') {
    const cover = pickString(readPath(covers, 'origin'), readPath(covers, 'default'));
    if (cover) return cover;
  }

  return pickString(
    item.coverUrl,
    item.dynamicCover,
    item.originCover,
    item.cover,
    item.imageUrl,
    readPath(item, 'video.dynamicCover'),
  );
}

function extractHashtags(item: RawTikTokItem, text: string): string[] {
  const rawTags = Array.isArray(item.hashtags) ? item.hashtags : [];

  const fromMeta = rawTags
    .map((tag) => (typeof tag === 'string' ? tag : tag?.name))
    .filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
    .map((tag) => tag.trim().toLowerCase());

  const fromText = Array.from(text.matchAll(/#([\p{L}\p{N}_]+)/gu))
    .map((match) => match[1])
    .filter((tag): tag is string => Boolean(tag))
    .map((tag) => tag.toLowerCase());

  return Array.from(new Set([...fromMeta, ...fromText])).slice(0, 20);
}

function extractCategory(item: RawTikTokItem): string | null {
  const rawCategory = pickString(
    item.category,
    item.categoryName,
    item.productCategory,
    item.industry,
    readPath(item, 'productInfo.category'),
  );
  return rawCategory?.slice(0, 120) ?? null;
}

function extractPrice(item: RawTikTokItem): number | null {
  const price = pickNumber(
    item.price,
    readPath(item, 'productInfo.price'),
    readPath(item, 'product.price'),
    readPath(item, 'item.price'),
    item.marketPrice,
    item.minPrice,
  );

  if (price === null || price <= 0) return null;
  return price;
}

function extractSales(item: RawTikTokItem): number | null {
  const explicit = pickNumber(
    item.soldCount,
    item.sold,
    item.sales,
    readPath(item, 'productInfo.soldCount'),
    readPath(item, 'product.soldCount'),
    readPath(item, 'product.sold'),
    readPath(item, 'item.soldCount'),
    readPath(item, 'item.sold'),
  );

  if (explicit !== null && explicit >= 0) return Math.trunc(explicit);
  return null;
}

function extractShop(item: RawTikTokItem): ScrapedShopRecord | null {
  const author = item.authorMeta ?? {};

  // Shop thật (TikTok Shop) ưu tiên các trường shop/seller riêng.
  // authorMeta được dùng làm fallback để giữ tương thích với payload video cũ.
  const explicitShopName = pickString(item.shopName, item.sellerName);
  const explicitUsername = pickString(item.shopUsername);
  const isExplicitShop = Boolean(explicitShopName || explicitUsername || item.shopId || item.sellerId);

  const username = pickString(explicitUsername, isExplicitShop ? undefined : author.name, item.username);
  const name = pickString(explicitShopName, isExplicitShop ? undefined : author.nickName, item.shopName, item.sellerName, username);

  if (!name) return null;

  const platformShopId = pickString(item.shopId, item.sellerId);
  // A creator/video author is not a shop identifier; never synthesize a shop id.
  if (!platformShopId) return null;

  return {
    platformShopId,
    name,
    username,
    avatarUrl: pickString(item.shopAvatar, isExplicitShop ? undefined : author.avatar),
    shopUrl: username ? `https://www.tiktok.com/@${username}` : null,
    followerCount: pickNumber(item.shopFollowerCount, item.shopFollowers, readPath(item, 'shop.followerCount')),
    revenueBreakdown: extractRevenueBreakdown(item),
  };
}

/**
 * Bóc tách doanh thu theo nguồn tiền (Video / Live / Giỏ hàng / Product card).
 * Nhiều payload chỉ trả tổng GMV -> phần thiếu được để null và đánh dấu estimated.
 */
function extractRevenueBreakdown(item: RawTikTokItem): ScrapedRevenueBreakdown | null {
  const gmvVideo = pickNumber(
    item.gmvVideo,
    readPath(item, 'revenue.video'),
    readPath(item, 'shopRevenue.video'),
    readPath(item, 'revenueBreakdown.video'),
  );
  const gmvLive = pickNumber(
    item.gmvLive,
    readPath(item, 'revenue.live'),
    readPath(item, 'shopRevenue.live'),
    readPath(item, 'revenueBreakdown.live'),
  );
  const gmvCart = pickNumber(
    item.gmvCart,
    readPath(item, 'revenue.cart'),
    readPath(item, 'shopRevenue.cart'),
    readPath(item, 'revenueBreakdown.cart'),
  );
  const gmvProductCard = pickNumber(
    item.gmvProductCard,
    readPath(item, 'revenue.productCard'),
    readPath(item, 'shopRevenue.productCard'),
    readPath(item, 'revenueBreakdown.productCard'),
  );
  const gmvTotal = pickNumber(
    item.gmvTotal,
    readPath(item, 'revenue.total'),
    readPath(item, 'shopRevenue.total'),
    readPath(item, 'revenueBreakdown.total'),
  );

  if (gmvVideo === null && gmvLive === null && gmvCart === null && gmvProductCard === null && gmvTotal === null) {
    return null;
  }

  return {
    gmvVideo,
    gmvLive,
    gmvCart,
    gmvProductCard,
    gmvTotal,
    isEstimated: gmvVideo === null || gmvLive === null,
  };
}

/**
 * Bóc tách creator/affiliate từ payload video (authorMeta) hoặc payload creative-center.
 */
function extractCreator(item: RawTikTokItem): ScrapedCreatorRecord | null {
  const author = item.authorMeta ?? {};
  const creatorMeta =
    item.creator && typeof item.creator === 'object' ? (item.creator as Record<string, unknown>) : {};

  const username = pickString(
    readPath(creatorMeta, 'uniqueId'),
    readPath(creatorMeta, 'username'),
    item.creatorUsername,
    author.name,
  );
  const displayName = pickString(
    readPath(creatorMeta, 'nickname'),
    readPath(creatorMeta, 'displayName'),
    item.creatorName,
    author.nickName,
    username,
  );

  const platformCreatorId = pickString(
    readPath(creatorMeta, 'id'),
    readPath(creatorMeta, 'userId'),
    item.creatorId,
    author.id,
  );

  if (!displayName || !platformCreatorId) return null;

  const followerCount = pickNumber(
    readPath(creatorMeta, 'followerCount'),
    readPath(creatorMeta, 'followers'),
    item.creatorFollowerCount,
    author.fans,
  );
  const engagementRate = pickNumber(
    readPath(creatorMeta, 'engagementRate'),
    item.creatorEngagementRate,
  );
  const gmvTotal = pickNumber(
    readPath(creatorMeta, 'gmv'),
    readPath(creatorMeta, 'gmvTotal'),
    item.creatorGmv,
  );
  const soldCount = pickNumber(
    readPath(creatorMeta, 'soldCount'),
    readPath(creatorMeta, 'sales'),
    item.creatorSoldCount,
  );
  const videoCount = pickNumber(
    readPath(creatorMeta, 'videoCount'),
    item.creatorVideoCount,
  );

  const isAffiliate =
    item.creatorRole === 'AFFILIATE' ||
    readPath(creatorMeta, 'role') === 'AFFILIATE' ||
    Boolean(item.isAffiliate);

  return {
    platformCreatorId,
    username,
    displayName,
    avatarUrl: pickString(readPath(creatorMeta, 'avatar'), readPath(creatorMeta, 'avatarUrl'), item.creatorAvatar, author.avatar),
    role: isAffiliate ? 'AFFILIATE' : 'CREATOR',
    followerCount,
    engagementRate,
    gmvTotal,
    soldCount,
    videoCount,
  };
}

function extractSellerCount(item: RawTikTokItem): number | null {
  const raw = pickNumber(
    item.sellerCount,
    item.shopCount,
    readPath(item, 'productInfo.sellerCount'),
    readPath(item, 'product.sellerCount'),
    readPath(item, 'productInfo.shopCount'),
    readPath(item, 'product.shopCount'),
  );
  return raw === null ? null : Math.max(0, Math.trunc(raw));
}

/**
 * Ngày đăng video gốc (metadata), KHÔNG dùng làm capturedAt của snapshot.
 * Snapshot phải phản ánh thời điểm cào để bucketDate/Delta GMV chính xác.
 */
function resolvePublishedAt(item: RawTikTokItem): Date | null {
  if (typeof item.createTimeISO === 'string') {
    const parsed = new Date(item.createTimeISO);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  if (item.createTime !== undefined && item.createTime !== null) {
    const numeric = toOptionalNumber(item.createTime);
    if (numeric !== null && numeric > 0) {
      return new Date(numeric > 1e12 ? numeric : numeric * 1000);
    }
  }

  return null;
}

function buildRawData(item: RawTikTokItem): Record<string, unknown> {
  return {
    playCount: item.playCount ?? null,
    diggCount: item.diggCount ?? null,
    shareCount: item.shareCount ?? null,
    commentCount: item.commentCount ?? null,
    author: item.authorMeta?.nickName ?? item.authorMeta?.name ?? null,
    searchQuery: item.searchQuery ?? null,
    hashtags: item.hashtags ?? null,
    music: item.musicMeta ?? null,
    sellerCount: item.sellerCount ?? null,
    creator: item.creator ?? null,
    publishedAt: resolvePublishedAt(item)?.toISOString() ?? null,
  };
}

/**
 * Chuẩn hoá 1 bản ghi thô từ Apify/Playwright thành record thống nhất.
 * Trả về null khi bản ghi không đủ điều kiện lưu (ví dụ tiêu đề rỗng).
 */
export function normalizeRawItem(item: RawTikTokItem, options: { capturedAt?: Date } = {}): ScrapedRecord | null {
  if (!item || typeof item !== 'object') return null;

  const text = pickString(item.text, item.desc, item.title, item.searchQuery);
  if (!text || text.length < MIN_TITLE_LENGTH) return null;

  // capturedAt = thời điểm cào (bucketDate đúng cho snapshot/Delta GMV).
  const capturedAt = options.capturedAt ?? new Date();
  const platformVideoId = pickString(item.id, item.aweme_id);
  const videoUrl = pickString(item.webVideoUrl, item.url) ?? (platformVideoId ? `https://www.tiktok.com/video/${platformVideoId}` : null);

  const playCount = pickNumber(item.playCount, readPath(item, 'stats.playCount'));
  const diggCount = pickNumber(item.diggCount, readPath(item, 'stats.diggCount'));
  const shareCount = pickNumber(item.shareCount, readPath(item, 'stats.shareCount'));
  const commentCount = pickNumber(item.commentCount, readPath(item, 'stats.commentCount'));

  const shop = extractShop(item);
  const explicitSales = extractSales(item);

  // ─── Biến thể / SKU: bóc tách đa phân khúc giá ─────────────────────────
  const variantInfo = extractVariants(item);
  const hasVariants = variantInfo.variants.length > 0;
  const variantMin = variantInfo.minPrice;
  const variantMax = variantInfo.maxPrice;

  // Only use sold counts present in the source payload; never infer sales from views.
  const variantSold = variantInfo.totalSold;
  const salesTotal = explicitSales ?? variantSold;

  const rawPrice = extractPrice(item);
  const priceFromVariants = variantMin ? Number(variantMin.toString()) : null;
  const price = priceFromVariants ?? rawPrice;
  const gmvTotal = price !== null && salesTotal !== null ? Math.round(price * salesTotal) : null;

  const platformProductId = pickString(
    readPath(item, 'productInfo.productId'),
    readPath(item, 'product.productId'),
    readPath(item, 'product.id'),
    readPath(item, 'item.productId'),
    readPath(item, 'item.id'),
  );
  // Video ids are not product ids; skip rows without a real product identifier.
  if (!platformProductId) return null;

  const description = pickString(item.description, item.desc) ?? null;
  const rawCategory = extractCategory(item);
  const classification = classifyProduct({ title: text, description, rawCategory });

  const product: ScrapedProductRecord = {
    platformProductId,
    title: text,
    description,
    imageUrl: extractImageUrl(item),
    productUrl: videoUrl,
    category: classification.category,
    subCategory: classification.subCategory,
    price,
    salesTotal,
    gmvTotal,
    sellerCount: extractSellerCount(item),
    minPrice: variantMin,
    maxPrice: variantMax ?? (hasVariants ? variantMin : null),
    variants: variantInfo.variants.map((variant) => ({
      platformSkuId: variant.platformSkuId,
      name: variant.name,
      price: variant.price,
      stock: variant.stock,
      soldCount: variant.soldCount,
      attributes: variant.attributes,
    })),
    playCount: playCount === null ? null : Math.trunc(playCount),
    diggCount: diggCount === null ? null : Math.trunc(diggCount),
    shareCount: shareCount === null ? null : Math.trunc(shareCount),
    commentCount: commentCount === null ? null : Math.trunc(commentCount),
    // This pipeline computes GMV as current price × reported sales.
    isEstimated: gmvTotal !== null,
    capturedAt,
    rawData: {
      ...buildRawData(item),
      rawCategory,
      classifiedCategory: classification.category,
      classifiedSubCategory: classification.subCategory,
      classificationMatched: classification.matched,
    },
  };

  const creator = extractCreator(item);

  return {
    platformVideoId,
    content: text,
    author: shop?.name ?? creator?.displayName ?? null,
    videoUrl,
    keywords: extractHashtags(item, text),
    trendMetrics: {
      playCount: product.playCount,
      diggCount: product.diggCount,
      shareCount: product.shareCount,
      commentCount: product.commentCount,
    },
    shop,
    creator,
    product,
  };
}

export function normalizeRawItems(items: readonly RawTikTokItem[], options: { capturedAt?: Date } = {}): ScrapedRecord[] {
  const records: ScrapedRecord[] = [];
  for (const item of items) {
    const normalized = normalizeRawItem(item, options);
    if (normalized) records.push(normalized);
  }
  return records;
}

export interface NormalizeFailure {
  index: number;
  message: string;
}

export interface NormalizeResult {
  records: ScrapedRecord[];
  failures: NormalizeFailure[];
  /** Số item bị bỏ qua vì không đủ điều kiện (không phải lỗi). */
  skipped: number;
}

/**
 * Chuẩn hoá an toàn từng item: 1 bản ghi lỗi định dạng/thiếu dữ liệu
 * không làm sập toàn bộ chu kỳ cào.
 */
export function normalizeRawItemsSafe(
  items: readonly RawTikTokItem[],
  options: { capturedAt?: Date } = {},
): NormalizeResult {
  const records: ScrapedRecord[] = [];
  const failures: NormalizeFailure[] = [];
  let skipped = 0;

  for (let index = 0; index < items.length; index += 1) {
    try {
      const normalized = normalizeRawItem(items[index] as RawTikTokItem, options);
      if (normalized) records.push(normalized);
      else skipped += 1;
    } catch (error) {
      failures.push({
        index,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { records, failures, skipped };
}

export function sortByViewsDesc(records: readonly ScrapedRecord[]): ScrapedRecord[] {
  return [...records].sort((a, b) => toFiniteNumber(b.product.playCount) - toFiniteNumber(a.product.playCount));
}
