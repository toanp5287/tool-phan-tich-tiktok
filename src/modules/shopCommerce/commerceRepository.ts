import type { Prisma } from '@prisma/client';
import prisma from '../../config/db.js';
import { buildAnalyticsWindow } from '../../utils/dates.js';
import { bigIntToNumber, decimalToNumber } from '../../utils/numbers.js';
import { estimateProductRevenue } from './revenue.js';
import {
  buildMultiPeriod,
  buildMultiPeriodAggregate,
  createAccumulator,
  accumulate,
  commerceLookbackStart,
  currentAnchor,
  periodWindows,
  valueAt,
  type AggregateAccumulator,
  type CumulativePoint,
  type PeriodWindow,
} from './metrics.js';
import type {
  MultiPeriodMetrics,
  RangeMeta,
  ShopCommerceCategoryCard,
  ShopCommerceCreatorCard,
  ShopCommerceCreatorDetail,
  ShopCommerceProductCard,
  ShopCommerceProductDetail,
  ShopCommerceShopCard,
  ShopCommerceShopDetail,
  ShopCommerceTrendVideo,
} from './shopCommerceTypes.js';

/* ------------------------------------------------------------------ */
/* Chuyển kiểu an toàn                                                 */
/* ------------------------------------------------------------------ */

const PRODUCT_SNAPSHOT_SELECT = {
  productId: true,
  bucketDate: true,
  capturedAt: true,
  price: true,
  originalPrice: true,
  soldCountTotal: true,
  gmvTotal: true,
  stockTotal: true,
  ratingScore: true,
  ratingCount: true,
  sellerCount: true,
  playCount: true,
  diggCount: true,
  shareCount: true,
  commentCount: true,
} as const;

type ProductSnapshotRow = Prisma.ProductSnapshotGetPayload<{ select: typeof PRODUCT_SNAPSHOT_SELECT }>;

/** Chỉ các cột thương mại — tuyệt đối không có `rating`/`reviewCount` legacy. */
export function toCumulativePoint(row: {
  bucketDate: Date;
  capturedAt: Date;
  price: Prisma.Decimal | null;
  soldCountTotal: bigint | null;
  gmvTotal: Prisma.Decimal | null;
  stockTotal?: number | null;
  ratingScore?: Prisma.Decimal | null;
  ratingCount?: bigint | null;
  playCount: bigint | null;
  diggCount: bigint | null;
  shareCount: bigint | null;
  commentCount: bigint | null;
}): CumulativePoint {
  return {
    bucketDate: row.bucketDate,
    capturedAt: row.capturedAt,
    sold: bigIntToNumber(row.soldCountTotal) ?? 0,
    gmv: decimalToNumber(row.gmvTotal) ?? 0,
    price: decimalToNumber(row.price) ?? 0,
    playCount: bigIntToNumber(row.playCount) ?? 0,
    diggCount: bigIntToNumber(row.diggCount) ?? 0,
    shareCount: bigIntToNumber(row.shareCount) ?? 0,
    commentCount: bigIntToNumber(row.commentCount) ?? 0,
    stockTotal: row.stockTotal ?? null,
    ratingScore: decimalToNumber(row.ratingScore ?? null),
    ratingCount: bigIntToNumber(row.ratingCount ?? null),
  };
}

const REGION = 'VN';

/** Chỉ lấy sản phẩm/shop thuộc thị trường Việt Nam. */
const PRODUCT_REGION_FILTER: Prisma.ProductWhereInput = { region: REGION };
const SHOP_REGION_FILTER: Prisma.ShopWhereInput = { region: REGION };

/* ------------------------------------------------------------------ */
/* Nạp chuỗi snapshot cho nhiều sản phẩm                               */
/* ------------------------------------------------------------------ */

export interface ProductSeriesBundle {
  productId: number;
  series: CumulativePoint[];
  latest: CumulativePoint | null;
  previous: CumulativePoint | null;
}

/**
 * Nạp snapshot luỹ kế (bucketDate <= hôm nay, theo region VN) cho danh sách sản phẩm.
 * Chỉ nạp tối đa 2x90 ngày để giữ truy vấn nhẹ.
 */
export async function loadProductSeries(
  productIds: readonly number[],
  now: Date = new Date(),
  anchor: RangeMeta['anchor'] = 'today',
): Promise<Map<number, ProductSeriesBundle>> {
  if (productIds.length === 0) return new Map();

  const rows = await prisma.productSnapshot.findMany({
    where: { productId: { in: [...productIds] }, bucketDate: { gte: commerceLookbackStart(now) } },
    select: PRODUCT_SNAPSHOT_SELECT,
    orderBy: [{ bucketDate: 'asc' }, { capturedAt: 'asc' }],
  });

  const grouped = new Map<number, CumulativePoint[]>();

  for (const row of rows) {
    const point = toCumulativePoint(row);
    let bucket = grouped.get(row.productId);
    if (!bucket) {
      bucket = [];
      grouped.set(row.productId, bucket);
    }
    bucket.push(point);
  }

  const windows = periodWindows(now, anchor);
  const today = currentAnchor(now, anchor);

  const result = new Map<number, ProductSeriesBundle>();
  for (const [productId, series] of grouped) {
    result.set(productId, {
      productId,
      series,
      latest: valueAt(series, today),
      previous: valueAt(series, windows[0] ? windows[0].base : today),
    });
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Product card                                                       */
/* ------------------------------------------------------------------ */

interface ShopRef {
  id: number;
  name: string;
  avatarUrl: string | null;
  bannerUrl?: string | null;
  shopUrl?: string | null;
}

/**
 * Kiểu cấu trúc (structural) chấp nhận cả sản phẩm có FK trực tiếp `shop`
 * lẫn sản phẩm chỉ có bảng nối `productShops`.
 */
interface ProductWithShops {
  id: number;
  platformProductId: string;
  title: string;
  imageUrl: string | null;
  productUrl: string | null;
  category: string | null;
  subCategory: string | null;
  minPrice: Prisma.Decimal | null;
  maxPrice: Prisma.Decimal | null;
  minOriginalPrice: Prisma.Decimal | null;
  maxOriginalPrice: Prisma.Decimal | null;
  stockTotal: number | null;
  ratingScore: Prisma.Decimal | null;
  ratingCount: bigint | null;
  isAvailable: boolean;
  variantCount: number;
  sellerCount: number;
  soldCount: bigint | null;
  lastSeenAt: Date;
  shop?: ShopRef | null;
  productShops: Array<{ shop: ShopRef }>;
}

export function toProductCard(
  product: ProductWithShops,
  bundle: ProductSeriesBundle | undefined,
  growth: MultiPeriodMetrics,
  fallbackShopName = 'TikTok Shop',
): ShopCommerceProductCard {
  const latest = bundle?.latest ?? null;
  // Ưu tiên FK trực tiếp Product.shopId, fallback bảng nối ProductShop.
  const shop = product.shop ?? product.productShops[0]?.shop ?? null;

  return {
    id: product.id,
    platformProductId: product.platformProductId,
    title: product.title,
    imageUrl: product.imageUrl,
    productUrl: product.productUrl,
    category: product.category,
    subCategory: product.subCategory,
    shopId: shop?.id ?? null,
    shopName: shop?.name ?? fallbackShopName,
    price: latest?.price ?? decimalToNumber(product.minPrice) ?? 0,
    minPrice: decimalToNumber(product.minPrice),
    maxPrice: decimalToNumber(product.maxPrice),
    minOriginalPrice: decimalToNumber(product.minOriginalPrice),
    maxOriginalPrice: decimalToNumber(product.maxOriginalPrice),
    variantCount: product.variantCount,
    stockTotal: latest?.stockTotal ?? product.stockTotal,
    ratingScore: latest?.ratingScore ?? decimalToNumber(product.ratingScore),
    ratingCount: latest?.ratingCount ?? bigIntToNumber(product.ratingCount) ?? 0,
    soldCount: latest?.sold ?? bigIntToNumber(product.soldCount) ?? 0,
    sellerCount: latest && product.sellerCount === 0 ? product.sellerCount : product.sellerCount,
    gmv: latest?.gmv ?? 0,
    growthRate: growth.primary.gmv.growthRate,
    growth,
    lastSeenAt: product.lastSeenAt.toISOString(),
  };
}

export function buildProductGrowth(
  bundle: ProductSeriesBundle | undefined,
  now: Date,
  range: number | RangeMeta,
): MultiPeriodMetrics {
  const selectedDays = typeof range === 'number' ? range : range.days;
  const anchor = typeof range === 'number' ? 'today' : range.anchor;
  const windows = periodWindows(now, anchor);
  if (!bundle) return buildMultiPeriod([], windows, selectedDays);
  return buildMultiPeriod(bundle.series, windows, selectedDays);
}

/* ------------------------------------------------------------------ */
/* Product listing / detail                                           */
/* ------------------------------------------------------------------ */

export interface ProductQuery {
  search?: string;
  category?: string;
  subCategory?: string;
  shopId?: number;
  sortBy?: 'gmv' | 'sales' | 'price' | 'recent' | 'sellers';
  sortDir?: 'asc' | 'desc';
  page: number;
  pageSize: number;
  range: RangeMeta;
}

const PRODUCT_INCLUDE = {
  shop: { select: { id: true, name: true, avatarUrl: true, bannerUrl: true, shopUrl: true } },
  productShops: {
    where: { isActive: true },
    orderBy: { lastSeenAt: 'desc' },
    take: 1,
    select: { shop: { select: { id: true, name: true, avatarUrl: true, bannerUrl: true, shopUrl: true } } },
  },
} satisfies Prisma.ProductInclude;

export async function listCommerceProducts(query: ProductQuery): Promise<{
  items: ShopCommerceProductCard[];
  total: number;
}> {
  const now = new Date();
  const where: Prisma.ProductWhereInput = { ...PRODUCT_REGION_FILTER };

  if (query.search) {
    where.OR = [
      { title: { contains: query.search, mode: 'insensitive' } },
      { platformProductId: { equals: query.search } },
      { productShops: { some: { shop: { name: { contains: query.search, mode: 'insensitive' } } } } },
    ];
  }
  if (query.category) where.category = query.category;
  if (query.subCategory) where.subCategory = query.subCategory;
  if (query.shopId) where.productShops = { some: { shopId: query.shopId, isActive: true } };

  const total = await prisma.product.count({ where });

  // Sắp xếp theo cột server-side khi có thể; còn lại sắp xếp sau khi tính delta.
  const orderBy: Prisma.ProductOrderByWithRelationInput[] =
    query.sortBy === 'price'
      ? [{ minPrice: query.sortDir ?? 'desc' }]
      : query.sortBy === 'sellers'
        ? [{ sellerCount: query.sortDir ?? 'desc' }]
        : [{ lastSeenAt: 'desc' }, { id: 'desc' }];

  const serverSorted = query.sortBy === 'price' || query.sortBy === 'sellers' || query.sortBy === undefined || query.sortBy === 'recent';
  const skip = serverSorted ? (query.page - 1) * query.pageSize : 0;
  const take = serverSorted ? query.pageSize : Math.max(query.page * query.pageSize, query.pageSize);

  const products = await prisma.product.findMany({
    where,
    include: PRODUCT_INCLUDE,
    orderBy,
    skip,
    take,
  });

  const series = await loadProductSeries(
    products.map((product) => product.id),
    now,
    query.range.anchor,
  );

  let items = products.map((product) =>
    toProductCard(product, series.get(product.id), buildProductGrowth(series.get(product.id), now, query.range)),
  );

  if (!serverSorted && query.sortBy) {
    const direction = query.sortDir === 'asc' ? 1 : -1;
    const accessor =
      query.sortBy === 'gmv'
        ? (item: ShopCommerceProductCard) => item.gmv
        : (item: ShopCommerceProductCard) => item.soldCount;
    items = items
      .sort((a, b) => (accessor(a) - accessor(b)) * direction)
      .slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
  }

  return { items, total };
}

export async function getCommerceProductDetail(
  productId: number,
  range: RangeMeta,
): Promise<ShopCommerceProductDetail> {
  const now = new Date();
  const product = await prisma.product.findFirst({
    where: { id: productId, ...PRODUCT_REGION_FILTER },
    include: {
      ...PRODUCT_INCLUDE,
      variants: { orderBy: [{ price: 'asc' }, { id: 'asc' }] },
    },
  });

  if (!product) throw notFound(`Không tìm thấy sản phẩm TikTok Shop VN #${productId}`);

  const series = await loadProductSeries([product.id], now, range.anchor);
  const bundle = series.get(product.id);
  const growth = buildProductGrowth(bundle, now, range);
  const card = toProductCard(product, bundle, growth);

  const [videos, creators] = await Promise.all([
    prisma.trendItem.findMany({
      where: { productId: product.id },
      orderBy: [{ playCount: 'desc' }, { scrapedAt: 'desc' }],
      take: 6,
    }),
    prisma.productCreator.findMany({
      where: { productId: product.id, isActive: true },
      orderBy: [{ gmvTotal: 'desc' }, { soldCount: 'desc' }],
      take: 10,
      include: { creator: true },
    }),
  ]);

  const timeline = buildTimeline(bundle, range);
  const shop = product.shop ?? product.productShops[0]?.shop ?? null;

  return {
    ...card,
    description: product.description,
    currency: product.currency,
    region: product.region,
    firstSeenAt: product.firstSeenAt.toISOString(),
    variants: product.variants.map((variant) => ({
      id: variant.id,
      platformSkuId: variant.platformSkuId,
      name: variant.name,
      price: decimalToNumber(variant.price),
      originalPrice: decimalToNumber(variant.originalPrice),
      stock: variant.stock,
      soldCount: variant.soldCount,
      isAvailable: variant.isAvailable,
      attributes: isStringRecord(variant.attributes) ? variant.attributes : null,
    })),
    timeline,
    revenueSources: estimateProductRevenue(card.gmv),
    topTrendVideos: videos.map(toTrendVideo),
    topCreators: creators.map((link) => creatorLinkToCard(link, now, range)),
    shop: shop
      ? {
          id: shop.id,
          name: shop.name,
          avatarUrl: shop.avatarUrl,
          bannerUrl: shop.bannerUrl ?? null,
          shopUrl: shop.shopUrl ?? null,
        }
      : null,
  };
}

function buildTimeline(
  bundle: ProductSeriesBundle | undefined,
  range: RangeMeta,
): Array<{ date: string; gmv: number; sales: number }> {
  if (!bundle || bundle.series.length === 0) return [];

  const window = buildAnalyticsWindow(range.days, new Date(), range.anchor);
  const allowed = new Set(window.daysList.map((day) => day.toISOString().slice(0, 10)));
  const byDay = new Map<string, { date: string; gmv: number; sales: number }>();
  const series = bundle.series;
  let previous = series[0] ?? null;

  for (let index = 1; index < series.length; index += 1) {
    const point = series[index];
    if (!point || !previous) continue;
    const date = point.bucketDate.toISOString().slice(0, 10);
    if (allowed.has(date)) {
      byDay.set(date, {
        date,
        gmv: Math.max(0, point.gmv - previous.gmv),
        sales: Math.max(0, point.sold - previous.sold),
      });
    }
    previous = point;
  }

  return window.daysList.map((day) => {
    const date = day.toISOString().slice(0, 10);
    return byDay.get(date) ?? { date, gmv: 0, sales: 0 };
  });
}

/* ------------------------------------------------------------------ */
/* Shop card                                                          */
/* ------------------------------------------------------------------ */

export function toTrendVideo(row: {
  id: number;
  platformVideoId: string | null;
  content: string;
  author: string | null;
  videoUrl: string | null;
  coverUrl?: string | null;
  playCount: bigint | null;
  diggCount: bigint | null;
  shareCount: bigint | null;
  commentCount: bigint | null;
  productId: number | null;
  shopId?: number | null;
  scrapedAt: Date;
}): ShopCommerceTrendVideo {
  const playCount = bigIntToNumber(row.playCount) ?? 0;
  const diggCount = bigIntToNumber(row.diggCount) ?? 0;
  const shareCount = bigIntToNumber(row.shareCount) ?? 0;
  const commentCount = bigIntToNumber(row.commentCount) ?? 0;
  const engagementRate = playCount > 0 ? ((diggCount + shareCount + commentCount) * 100) / playCount : 0;

  return {
    id: row.id,
    platformVideoId: row.platformVideoId,
    content: row.content,
    author: row.author,
    videoUrl: row.videoUrl,
    coverUrl: row.coverUrl ?? null,
    playCount,
    viewsCount: playCount,
    diggCount,
    shareCount,
    commentCount,
    engagementRate: Math.round(engagementRate * 100) / 100,
    productId: row.productId,
    shopId: row.shopId ?? null,
    scrapedAt: row.scrapedAt.toISOString(),
  };
}

type CreatorLinkRow = Prisma.ProductCreatorGetPayload<{
  include: { creator: true };
}>;

export function creatorLinkToCard(
  link: CreatorLinkRow,
  now: Date,
  range: number | RangeMeta,
): ShopCommerceCreatorCard {
  const gmv = decimalToNumber(link.gmvTotal) ?? decimalToNumber(link.creator.gmvTotal);
  const sold = bigIntToNumber(link.soldCount) ?? bigIntToNumber(link.creator.soldCount);

  return {
    id: link.creator.id,
    platformCreatorId: link.creator.platformCreatorId,
    username: link.creator.username,
    displayName: link.creator.displayName,
    avatarUrl: link.creator.avatarUrl,
    role: link.creator.role,
    followerCount: bigIntToNumber(link.creator.followerCount),
    engagementRate: decimalToNumber(link.creator.engagementRate),
    gmv,
    soldCount: sold,
    videoCount: link.videoCount ?? link.creator.videoCount,
    growthRate: 0,
    growth: emptyGrowth(now, range),
    topProducts: [],
  };
}

export function emptyGrowth(now: Date, range: number | RangeMeta): MultiPeriodMetrics {
  const days = typeof range === 'number' ? range : range.days;
  const anchor = typeof range === 'number' ? 'today' : range.anchor;
  const windows = periodWindows(now, anchor);
  return buildMultiPeriod([], windows, days);
}

/** Helper dùng chung để lấy accumulator GMV/sales theo nhiều kỳ cho 1 chuỗi. */
export function accumulateSeries(
  windows: readonly PeriodWindow[],
  series: readonly CumulativePoint[],
): Map<number, AggregateAccumulator> {
  const map = new Map<number, AggregateAccumulator>();
  for (const window of windows) {
    const acc = createAccumulator();
    accumulate(acc, series, window);
    map.set(window.days, acc);
  }
  return map;
}

export { buildMultiPeriodAggregate };

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every((entry) => typeof entry === 'string');
}

function notFound(message: string): Error {
  const error = new Error(message);
  (error as Error & { statusCode?: number; code?: string }).statusCode = 404;
  (error as Error & { statusCode?: number; code?: string }).code = 'NOT_FOUND';
  return error;
}

/* ------------------------------------------------------------------ */
/* Re-export kiểu để service khác dùng                                */
/* ------------------------------------------------------------------ */

export type {
  ShopCommerceCategoryCard,
  ShopCommerceCreatorCard,
  ShopCommerceCreatorDetail,
  ShopCommerceProductCard,
  ShopCommerceProductDetail,
  ShopCommerceShopCard,
  ShopCommerceShopDetail,
  ShopCommerceTrendVideo,
  MultiPeriodMetrics,
};
