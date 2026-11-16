import { classifyProduct } from '../../utils/classifier.js';
import { pickText, readPath, readCurrency, toOptionalCount, toOptionalMoney, toOptionalRating } from '../../utils/money.js';
import { toOptionalDecimal } from '../../utils/numbers.js';
import { detectMarket } from './market.js';
import type {
  RawShopItem,
  RawShopRating,
  RawShopSeller,
  RawShopStore,
  RawShopVariant,
  RawShopVideo,
  ScrapedShopAffiliate,
  ScrapedShopInfo,
  ScrapedShopProduct,
  ScrapedShopRecord,
  ScrapedShopRevenue,
  ScrapedShopVariant,
  ScrapedShopVideo,
} from '../../types/shopScrape.js';

const MAX_VARIANTS = 300;

export interface NormalizeShopOptions {
  capturedAt?: Date;
  /** Thị trường bắt buộc. Mặc định 'VN' — mọi item khác bị loại. */
  requiredMarket?: string;
  /** Cho phép item không xác định được thị trường (mặc định false để an toàn). */
  allowUnknownMarket?: boolean;
}

/**
 * Chuẩn hoá 1 item TikTok Shop.
 *
 * - CHỈ chấp nhận dữ liệu thị trường Việt Nam (currency VND hoặc URL /vn/).
 *   Item US/không rõ nguồn bị loại để không làm bẩn dữ liệu đồ án.
 * - Chỉ đọc các trường thương mại điện tử (không dùng playCount/like/share).
 * - Mọi item lỗi trả về null; lỗi ném ra được bọc bởi nơi gọi để cô lập từng item.
 * - `capturedAt` là thời điểm cào, dùng cho bucketDate & delta GMV.
 */
export function normalizeShopItem(item: RawShopItem, options: NormalizeShopOptions = {}): ScrapedShopRecord | null {
  if (!item || typeof item !== 'object') return null;
  if (typeof item.errorCode === 'string' && item.errorCode) return null;

  const requiredMarket = (options.requiredMarket ?? 'VN').toUpperCase();
  const market = detectMarket(item, requiredMarket);
  if (requiredMarket === 'VN' && market === 'US') return null;
  if (market === 'UNKNOWN' && !options.allowUnknownMarket && requiredMarket !== 'UNKNOWN') {
    // Không có tín hiệu VN rõ ràng => loại để tuyệt đối không lẫn dữ liệu ngoài VN.
    return null;
  }

  const capturedAt = options.capturedAt ?? new Date();
  const title = pickText(item.title, readPath(item, 'product_name'), readPath(item, 'productTitle'));
  if (!title || title.length < 2) return null;

  const platformProductId = pickText(
    item.productId,
    readPath(item, 'product_id'),
    readPath(item, 'id'),
    readPath(item, 'productInfo.productId'),
  );
  if (!platformProductId) return null;

  const variants = extractShopVariants(item);
  const variantPrices = variants
    .map((variant) => variant.price)
    .filter((price): price is NonNullable<typeof price> => price !== null);
  const variantOriginalPrices = variants
    .map((variant) => variant.originalPrice)
    .filter((price): price is NonNullable<typeof price> => price !== null);

  // memo23: price (min) / priceMax (max); clockworks: salePrice{value}.
  const directPrice = toOptionalMoney(
    item.salePrice ?? item.price ?? readPath(item, 'price') ?? readPath(item, 'final_price'),
  );
  const directPriceMax = toOptionalMoney(item.priceMax ?? readPath(item, 'price_max'));
  const directOriginal = toOptionalMoney(
    item.originalPrice ?? readPath(item, 'initial_price') ?? readPath(item, 'marketPrice'),
  );

  const minPrice = minDecimal(variantPrices) ?? directPrice;
  const maxPrice = maxDecimal(variantPrices) ?? directPriceMax ?? directPrice;
  const minOriginalPrice = minDecimal(variantOriginalPrices) ?? directOriginal;
  const maxOriginalPrice = maxDecimal(variantOriginalPrices) ?? directOriginal;

  // Giá đại diện: giá sàn của biến thể (SKU), fallback giá hiển thị.
  const price = minPrice ?? directPrice;
  const originalPrice = directOriginal ?? maxOriginalPrice ?? null;

  const stockTotal = sumNullable(
    variants.map((variant) => variant.stock),
  ) ?? toOptionalCount(item.totalStock ?? readPath(item, 'total_stock'));

  const rating = extractRating(item.rating, item.average_rating, item.reviewCount);
  const soldCount = extractSoldCount(item);
  const description = pickText(item.description, readPath(item, 'product_description'));

  const rawCategory = pickText(
    firstString(item.categories),
    item.category,
    readPath(item, 'category'),
    readPath(item, 'category_name'),
    readPath(item, 'categoryName'),
    readPath(item, 'productInfo.category'),
    readPath(item, 'product_category'),
  );
  const classification = classifyProduct({ title, description, rawCategory });

  const categoryFromUrl = categoryFromUrlPath(item.category_url);

  const product: ScrapedShopProduct = {
    platformProductId,
    title,
    description,
    imageUrl: pickText(item.image, readPath(item, 'image_url'), readPath(item, 'cover'), firstString(item.images)),
    productUrl: pickText(item.productUrl, readPath(item, 'product_url'), readPath(item, 'url')),
    category: classification.category ?? categoryFromUrl ?? rawCategory,
    subCategory: classification.subCategory,
    currency: readCurrency(item.salePrice, item.currency, item.originalPrice) ?? 'VND',
    price,
    originalPrice,
    minPrice,
    maxPrice: maxPrice ?? (variants.length > 0 ? minPrice : null),
    minOriginalPrice,
    maxOriginalPrice: maxOriginalPrice ?? (variants.length > 0 ? minOriginalPrice : null),
    soldCount,
    sellerCount: toOptionalCount(item.sellerCount ?? readPath(item, 'seller_count')),
    stockTotal,
    ratingScore: rating.score,
    ratingCount: rating.count,
    isAvailable: resolveAvailability(item, variants),
    variants,
    capturedAt,
    rawData: buildRawData(item, variants),
  };

  const shop = extractShopInfo(item);
  if (!shop) return null;

  const affiliates = extractAffiliates(item);
  const revenue = extractRevenue(item, product);
  const videos = extractVideos(item, title);

  return { shop, product, affiliates, revenue, videos };
}

/* ------------------------------------------------------------------ */
/* Biến thể / SKU                                                     */
/* ------------------------------------------------------------------ */

function extractShopVariants(item: RawShopItem): ScrapedShopVariant[] {
  const rawList = Array.isArray(item.variants)
    ? item.variants
    : Array.isArray(readPath(item, 'skus'))
      ? (readPath(item, 'skus') as RawShopVariant[])
      : Array.isArray(readPath(item, 'product_variants'))
        ? (readPath(item, 'product_variants') as RawShopVariant[])
        : [];

  const variants: ScrapedShopVariant[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < rawList.length && variants.length < MAX_VARIANTS; index += 1) {
    const raw = rawList[index];
    if (!raw || typeof raw !== 'object') continue;

    const attributes = extractVariantAttributes(raw);
    const name = pickText(raw.name, raw.skuName, raw.title) ?? (attributes ? Object.values(attributes).join(' / ') : null);

    const price = toOptionalMoney(raw.salePrice ?? raw.price ?? readPath(raw, 'priceInfo.salePrice'));
    const originalPrice = toOptionalMoney(raw.originalPrice ?? readPath(raw, 'priceInfo.originalPrice'));

    const stock = toOptionalCount(raw.availableQuantity ?? raw.stock ?? readPath(raw, 'stockInfo.stock'));
    const soldCount = toOptionalCount(raw.soldCount);

    if (price === null && stock === null && !name) continue;

    // Do not invent SKU identities from names or array positions.
    const platformSkuId = pickText(raw.variantId, raw.skuId, raw.id, raw.skuCode);
    if (!platformSkuId) continue;

    if (seen.has(platformSkuId)) continue;
    seen.add(platformSkuId);

    variants.push({
      platformSkuId,
      name,
      price,
      originalPrice,
      stock,
      soldCount,
      isAvailable: typeof raw.hasStock === 'boolean' ? raw.hasStock : (stock ?? 0) > 0,
      attributes,
    });
  }

  return variants;
}

function extractVariantAttributes(raw: RawShopVariant): Record<string, string> | null {
  const attributes: Record<string, string> = {};

  // memo23: attributes là object { Flavor: "Chocolate" }.
  if (raw.attributes && typeof raw.attributes === 'object' && !Array.isArray(raw.attributes)) {
    for (const [key, value] of Object.entries(raw.attributes)) {
      const normalized = pickText(value);
      if (key && normalized) attributes[key] = normalized;
    }
  }

  // clockworks: properties là mảng [{ name, value }].
  const properties = Array.isArray(raw.properties) ? raw.properties : [];
  for (const property of properties) {
    if (!property || typeof property !== 'object') continue;
    const key = pickText(property.name);
    const value = pickText(property.value);
    if (key && value) attributes[key] = value;
  }

  return Object.keys(attributes).length > 0 ? attributes : null;
}

/* ------------------------------------------------------------------ */
/* Shop                                                               */
/* ------------------------------------------------------------------ */

function extractShopInfo(item: RawShopItem): ScrapedShopInfo | null {
  const seller: RawShopSeller = item.seller && typeof item.seller === 'object' ? item.seller : {};
  const store: RawShopStore = item.shop && typeof item.shop === 'object' ? item.shop : {};

  const name = pickText(
    seller.shopName,
    store.name,
    item.shop_name,
    item.shopName,
    item.sellerName,
  );
  const shopUrl = pickText(seller.shopUrl, store.url, item.shop_url, item.shopUrl);
  const platformShopId = pickText(
    seller.sellerId,
    item.shop_id,
    item.sellerId,
    extractShopIdFromUrl(shopUrl),
  );

  // Never manufacture a shop identity from the product title.
  if (!name || !platformShopId) return null;

  const username = shopUrl ? extractUsernameFromUrl(shopUrl) : null;
  const avatarUrl = pickText(
    seller.shopLogoUrl,
    store.avatarUrl,
    store.logo,
    store.logoUrl,
    store.avatar,
    store.imageUrl,
    store.image,
    store.icon,
    item.shop_logo,
    item.shopAvatar,
    readPath(item, 'seller.avatar'),
    readPath(item, 'seller.logo'),
  );

  return {
    platformShopId,
    name,
    username,
    // Preserve only an actor-provided avatar URL; the UI handles missing images.
    avatarUrl,
    bannerUrl: pickText(
      store.bannerUrl,
      store.banner,
      store.coverUrl,
      store.cover,
      store.backgroundUrl,
      store.headerImage,
      item.shop_banner,
      item.bannerUrl,
      readPath(item, 'seller.banner'),
      readPath(item, 'seller.bannerUrl'),
    ),
    shopUrl,
    followerCount: toOptionalCount(
      seller.followerCount ??
        seller.shopFollowerCount ??
        store.followers ??
        item.follower_count ??
        item.shopFollowerCount,
    ),
    productCount: toOptionalCount(store.productCount ?? item.total_products ?? seller.productCount),
    ratingScore: toOptionalRating(
      store.rating ?? item.average_rating ?? readPath(item, 'shop.averageRating'),
    ),
    ratingCount: toOptionalCount(
      store.reviewCount ?? item.rating_count ?? readPath(item, 'shop.ratingCount'),
    ),
  };
}

/**
 * Lấy ID shop từ URL store của memo23:
 * `https://shop.tiktok.com/us/store/equip/7494352588342396208` -> `7494352588342396208`
 * `https://www.tiktok.com/shop/store/goli-nutrition/7495794203056835079` -> `7495794203056835079`
 */
function extractShopIdFromUrl(url: string | null): string | null {
  if (!url) return null;
  const match = url.match(/\/store\/[^/]+\/(\d+)/) ?? url.match(/\/store\/(\d+)/);
  return match?.[1] ?? null;
}

function extractUsernameFromUrl(url: string | null): string | null {
  if (!url) return null;
  const match = url.match(/@([A-Za-z0-9._-]+)/) ?? url.match(/shop\/([A-Za-z0-9._-]+)/);
  return match?.[1] ?? null;
}

/* ------------------------------------------------------------------ */
/* Affiliate / Creator                                                */
/* ------------------------------------------------------------------ */

function extractAffiliates(item: RawShopItem): ScrapedShopAffiliate[] {
  const rawList = Array.isArray(item.affiliates)
    ? item.affiliates
    : Array.isArray(readPath(item, 'top_affiliates'))
      ? (readPath(item, 'top_affiliates') as unknown[])
      : Array.isArray(readPath(item, 'creators'))
        ? (readPath(item, 'creators') as unknown[])
        : [];

  const affiliates: ScrapedShopAffiliate[] = [];

  for (const entry of rawList) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;

    const platformCreatorId = pickText(record.id, record.userId, record.creatorId, record.uid);
    const displayName = pickText(record.nickname, record.nickName, record.displayName, record.name, record.username);
    if (!platformCreatorId || !displayName) continue;

    affiliates.push({
      platformCreatorId,
      username: pickText(record.uniqueId, record.username, record.handle)?.replace(/^@/, '') ?? null,
      displayName,
      avatarUrl: pickText(record.avatar, record.avatarUrl, record.avatarThumb),
      followerCount: toOptionalCount(record.followerCount ?? record.followers ?? record.fans),
      engagementRate: toOptionalDecimal(record.engagementRate ?? record.engagement ?? record.interactionRate),
      gmvTotal: toOptionalMoney(record.gmv ?? record.gmvTotal ?? record.revenue ?? record.salesAmount),
      soldCount: toOptionalCount(record.soldCount ?? record.sales ?? record.unitsSold),
      videoCount: toOptionalCount(record.videoCount ?? record.videos),
    });
  }

  return affiliates;
}

/* ------------------------------------------------------------------ */
/* Doanh thu bóc tách                                                 */
/* ------------------------------------------------------------------ */

function extractRevenue(item: RawShopItem, product: ScrapedShopProduct): ScrapedShopRevenue | null {
  const gmvVideo = toOptionalMoney(
    item.gmvVideo ?? readPath(item, 'revenue.video') ?? readPath(item, 'revenueBreakdown.video'),
  );
  const gmvLive = toOptionalMoney(
    item.gmvLive ?? readPath(item, 'revenue.live') ?? readPath(item, 'revenueBreakdown.live'),
  );
  const gmvCart = toOptionalMoney(
    item.gmvCart ?? readPath(item, 'revenue.cart') ?? readPath(item, 'revenueBreakdown.cart'),
  );
  const gmvProductCard = toOptionalMoney(
    item.gmvProductCard ?? readPath(item, 'revenue.productCard') ?? readPath(item, 'revenueBreakdown.productCard'),
  );

  const explicitTotal = toOptionalMoney(
    item.gmvTotal ?? readPath(item, 'revenue.total') ?? readPath(item, 'revenueBreakdown.total'),
  );

  // Khi Actor không trả doanh thu bóc tách, ước tính GMV = giá * số bán
  // và đánh dấu isEstimated để UI hiển thị đúng bản chất dữ liệu.
  const hasBreakdown =
    gmvVideo !== null || gmvLive !== null || gmvCart !== null || gmvProductCard !== null || explicitTotal !== null;

  const estimatedGmv = estimateGmv(product);
  const gmvTotal = explicitTotal ?? estimatedGmv;

  if (gmvTotal === null && !hasBreakdown) return null;

  const soldCountTotal = product.soldCount;
  const avgOrderValue =
    gmvTotal !== null && soldCountTotal !== null && soldCountTotal > 0
      ? toOptionalDecimal(Number(gmvTotal.toString()) / soldCountTotal)
      : null;

  return {
    gmvVideo,
    gmvLive,
    gmvCart,
    gmvProductCard,
    gmvTotal,
    soldCountTotal,
    avgOrderValue,
    isEstimated: !hasBreakdown,
  };
}

function estimateGmv(product: ScrapedShopProduct) {
  if (product.price === null || product.soldCount === null || product.soldCount <= 0) return null;
  return toOptionalDecimal(Number(product.price.toString()) * product.soldCount);
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function extractRating(rawRating: unknown, fallback: unknown, explicitReviewCount?: unknown): {
  score: ScrapedShopProduct['ratingScore'];
  count: number | null;
} {
  const rating: RawShopRating =
    rawRating && typeof rawRating === 'object' ? (rawRating as RawShopRating) : { score: rawRating as number };
  return {
    score: toOptionalRating(rating.score ?? fallback),
    count: toOptionalCount(rating.reviewCount ?? rating.count ?? explicitReviewCount),
  };
}

/**
 * Bóc tách video đang bán sản phẩm (memo23 `relatedVideos`).
 * Đây là video GẮN SẢN PHẨM — không phải video giải trí ngoài lề.
 */
function extractVideos(item: RawShopItem, productTitle: string): ScrapedShopVideo[] {
  const rawList = Array.isArray(item.relatedVideos) ? item.relatedVideos : [];
  const videos: ScrapedShopVideo[] = [];
  const seen = new Set<string>();

  for (const raw of rawList) {
    if (!raw || typeof raw !== 'object') continue;
    const video = raw as RawShopVideo;

    const videoUrl = pickText(video.url, readPath(video, 'videoUrl'), readPath(video, 'webVideoUrl'));
    const platformVideoId = extractVideoId(videoUrl, video.id ?? video.videoId ?? video.awemeId);
    if (!platformVideoId || seen.has(platformVideoId)) continue;
    seen.add(platformVideoId);

    const author = pickText(video.authorName, readPath(video, 'author'), readPath(video, 'nickname'));

    videos.push({
      platformVideoId,
      content: `Video bán "${productTitle}"${author ? ` bởi @${author}` : ''}`,
      author,
      authorId: pickText(video.authorId),
      isAffiliate: /commission|hoa hồng|affiliate/i.test(pickText(video.adLabel) ?? ''),
      videoUrl,
      coverUrl: pickText(video.coverUrl, video.cover, video.thumbnail, video.thumbnailUrl),
      playCount: toOptionalCount(video.playCount),
      diggCount: toOptionalCount(video.likeCount),
      shareCount: toOptionalCount(video.shareCount),
      commentCount: toOptionalCount(video.commentCount),
    });
  }

  return videos;
}

function extractVideoId(url: string | null, fallback?: string | number): string | null {
  if (url) {
    const match = url.match(/\/video\/(\d+)/);
    if (match?.[1]) return match[1];
  }
  return fallback !== undefined && fallback !== null && String(fallback).trim()
    ? String(fallback).trim()
    : null;
}

function extractSoldCount(item: RawShopItem): number | null {
  return toOptionalCount(
    item.soldCount ?? readPath(item, 'sold') ?? readPath(item, 'sales_count') ?? readPath(item, 'sales'),
  );
}

function resolveAvailability(item: RawShopItem, variants: ScrapedShopVariant[]): boolean {
  if (typeof item.available === 'boolean') return item.available;
  if (variants.length > 0) return variants.some((variant) => variant.isAvailable);
  return true;
}

function minDecimal<T extends { lt: (other: T) => boolean }>(values: T[]): T | null {
  let min: T | null = null;
  for (const value of values) {
    if (min === null || value.lt(min)) min = value;
  }
  return min;
}

function maxDecimal<T extends { gt: (other: T) => boolean }>(values: T[]): T | null {
  let max: T | null = null;
  for (const value of values) {
    if (max === null || value.gt(max)) max = value;
  }
  return max;
}

function sumNullable(values: Array<number | null>): number | null {
  let total: number | null = null;
  for (const value of values) {
    if (value === null) continue;
    total = (total ?? 0) + value;
  }
  return total;
}

function firstString(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  for (const entry of value) {
    if (typeof entry === 'string' && entry.trim()) return entry.trim();
  }
  return null;
}

function categoryFromUrlPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/\/shop\/c\/([^/?#]+)/);
  return match?.[1] ? match[1].replace(/-/g, ' ') : null;
}

function buildRawData(item: RawShopItem, variants: ScrapedShopVariant[]): Record<string, unknown> {
  return {
    productId: item.productId ?? null,
    variantId: item.variantId ?? null,
    labels: item.labels ?? null,
    seller: item.seller ?? null,
    // Giữ nguyên object shop thô để đối chiếu tên trường avatar/banner thật của Actor.
    shop: item.shop ?? null,
    imageCount: Array.isArray(item.images) ? item.images.length : 0,
    relatedVideoCount: Array.isArray(item.relatedVideos) ? item.relatedVideos.length : 0,
    searchRank: item.searchRank ?? null,
    bestSellerRank: item.bestSellerRank ?? null,
    detailed: item.detailed ?? null,
    rating: item.rating ?? null,
    categoryUrl: item.category_url ?? null,
    variantCount: variants.length,
    skuStock: variants.map((variant) => ({ sku: variant.platformSkuId, stock: variant.stock })),
    errorCode: item.errorCode ?? null,
  };
}

/**
 * Chuẩn hoá an toàn danh sách item: mỗi item trong try/catch riêng.
 * Một sản phẩm lỗi định dạng không làm gián đoạn chu kỳ cào.
 */
export function normalizeShopItemsSafe(
  items: readonly RawShopItem[],
  options: NormalizeShopOptions = {},
): { records: ScrapedShopRecord[]; failures: Array<{ index: number; message: string }>; skipped: number } {
  const records: ScrapedShopRecord[] = [];
  const failures: Array<{ index: number; message: string }> = [];
  let skipped = 0;

  for (let index = 0; index < items.length; index += 1) {
    try {
      const normalized = normalizeShopItem(items[index] as RawShopItem, options);
      if (normalized) records.push(normalized);
      else skipped += 1;
    } catch (error) {
      failures.push({ index, message: error instanceof Error ? error.message : String(error) });
    }
  }

  return { records, failures, skipped };
}
