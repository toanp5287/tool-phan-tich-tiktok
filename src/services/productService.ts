import type { Prisma } from '@prisma/client';
import prisma from '../config/db.js';
import { SNAPSHOT_WINDOW_DAYS } from '../config/constants.js';
import type { MetricPoint, MetricSeries, ProductDetail, ProductListItem } from '../types/api.js';
import { AppError } from '../utils/errors.js';
import { buildAnalyticsWindow, isoDateKey, eachDay, daysAgo } from '../utils/dates.js';
import { bigIntToNumber, clampInt, decimalToNumber, percentChange, roundTo } from '../utils/numbers.js';
import { toIso } from '../utils/serializers.js';
import { getProductCreators, getProductTrendVideos } from './creatorService.js';
import { buildGrowthFromSnapshot, serializeGrowth, type GrowthSummary } from './growthService.js';
import { getPreferredSnapshot, getPreferredSnapshotsByDate, logSourcePreference } from './sourcePriorityService.js';

export interface ProductListFilters {
  search?: string;
  region?: string;
  category?: string;
  subCategory?: string;
  shopId?: number;
  sortBy?: 'gmv' | 'sales' | 'views' | 'price' | 'recent' | 'sellers';
  sortDir?: 'asc' | 'desc';
  page: number;
  pageSize: number;
  days?: number;
  anchor?: 'today' | 'yesterday';
}

const SORT_ACCESSORS: Record<NonNullable<ProductListFilters['sortBy']>, (item: ProductListItem) => number> = {
  gmv: (item) => item.gmv,
  sales: (item) => item.sales,
  views: (item) => item.views,
  price: (item) => item.price,
  recent: (item) => (item.lastSeenAt ? Date.parse(item.lastSeenAt) : 0),
  sellers: (item) => item.sellerCount,
};

export async function listProducts(filters: ProductListFilters): Promise<{ items: ProductListItem[]; total: number }> {
  const window = buildAnalyticsWindow(
    clampInt(filters.days, 1, SNAPSHOT_WINDOW_DAYS.max, SNAPSHOT_WINDOW_DAYS.default),
    new Date(),
    filters.anchor ?? 'today',
  );
  const where: Prisma.ProductWhereInput = {};

  if (filters.search) {
    where.OR = [
      { title: { contains: filters.search, mode: 'insensitive' } },
      { description: { contains: filters.search, mode: 'insensitive' } },
      { platformProductId: { equals: filters.search } },
      { productShops: { some: { shop: { name: { contains: filters.search, mode: 'insensitive' } } } } },
    ];
  }

  if (filters.region) where.region = filters.region;
  if (filters.category) where.category = filters.category;
  if (filters.subCategory) where.subCategory = filters.subCategory;
  if (filters.shopId) where.productShops = { some: { shopId: filters.shopId } };

  // Chỉ lấy sản phẩm có snapshot trong kỳ phân tích đang chọn.
  where.snapshots = { some: { bucketDate: { gte: window.currentStart, lte: window.currentEnd } } };

  const total = await prisma.product.count({ where });
  const sortedInDb = filters.sortBy === undefined || filters.sortBy === 'recent';

  const products = await prisma.product.findMany({
    where,
    include: {
      snapshots: {
        where: { bucketDate: { gte: window.previousStart, lte: window.currentEnd } },
        orderBy: { bucketDate: 'desc' },
        take: 30,
      },
      productShops: {
        where: { isActive: true },
        orderBy: { lastSeenAt: 'desc' },
        take: 1,
        include: {
          shop: { select: { id: true, name: true, avatarUrl: true } },
          snapshots: {
            where: { bucketDate: { gte: window.currentStart, lte: window.currentEnd } },
            orderBy: { bucketDate: 'desc' },
            take: 1,
          },
        },
      },
    },
    orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }],
    ...(sortedInDb
      ? { skip: (filters.page - 1) * filters.pageSize, take: filters.pageSize }
      : { take: Math.max(filters.page * filters.pageSize, filters.pageSize) }),
  });

  let items = products.map((product) => {
    const current = product.snapshots.filter((snapshot) => snapshot.bucketDate >= window.currentStart);
    const previous = product.snapshots.filter((snapshot) => snapshot.bucketDate < window.currentStart);
    
    // Áp dụng source priority: lấy snapshot ưu tiên nhất từ từng khoảng thời gian
    const currentPreferred = getPreferredSnapshot(current);
    const previousPreferred = getPreferredSnapshot(previous);
    
    logSourcePreference([currentPreferred, previousPreferred].filter(Boolean) as typeof product.snapshots, `product_${product.id}`);
    
    const snapshots = [currentPreferred ?? previousPreferred, previousPreferred].filter(
      (snapshot): snapshot is NonNullable<typeof snapshot> => Boolean(snapshot),
    );
    
    return toProductListItem(
      {
        ...product,
        snapshots,
      },
      window,
    );
  });


  if (!sortedInDb && filters.sortBy) {
    const extractor = SORT_ACCESSORS[filters.sortBy];
    const direction = filters.sortDir === 'asc' ? 1 : -1;
    items = items
      .sort((a, b) => (extractor(a) - extractor(b)) * direction)
      .slice((filters.page - 1) * filters.pageSize, filters.page * filters.pageSize);
  }

  return { items, total };
}

function toProductListItem(
  product: {
    id: number;
    platformProductId: string;
    title: string;
    imageUrl: string | null;
    productUrl: string | null;
    category: string | null;
    subCategory: string | null;
    sellerCount: number;
    minPrice: Prisma.Decimal | null;
    maxPrice: Prisma.Decimal | null;
    minOriginalPrice: Prisma.Decimal | null;
    maxOriginalPrice: Prisma.Decimal | null;
    stockTotal: number | null;
    ratingScore: Prisma.Decimal | null;
    ratingCount: bigint | null;
    isAvailable: boolean;
    variantCount: number;
    lastSeenAt: Date;
    snapshots: Array<{
      source: string;
      price: Prisma.Decimal | null;
      originalPrice: Prisma.Decimal | null;
      stockTotal: number | null;
      ratingScore: Prisma.Decimal | null;
      ratingCount: bigint | null;
      soldCountTotal: bigint | null;
      soldCount1d: bigint | null;
      soldCount7d: bigint | null;
      soldCount30d: bigint | null;
      soldCount90d: bigint | null;
      gmvTotal: Prisma.Decimal | null;
      gmv1d: Prisma.Decimal | null;
      gmv7d: Prisma.Decimal | null;
      gmv30d: Prisma.Decimal | null;
      gmv90d: Prisma.Decimal | null;
      playCount: bigint | null;
      diggCount: bigint | null;
      shareCount: bigint | null;
      commentCount: bigint | null;
      sellerCount: number | null;
      capturedAt: Date;
      bucketDate: Date;
    }>;
    productShops: Array<{
      shop: { id: number; name: string; avatarUrl: string | null };
      snapshots: Array<{ price: Prisma.Decimal | null; soldCountTotal: bigint | null; gmvTotal: Prisma.Decimal | null }>;
    }>;
  },
  window?: ReturnType<typeof buildAnalyticsWindow>,
): ProductListItem {
  const currentSnapshots = window
    ? product.snapshots.filter((snapshot) => snapshot.bucketDate >= window.currentStart)
    : product.snapshots;
  const latest = currentSnapshots[0] ?? product.snapshots[0];
  const previous = currentSnapshots[1] ?? product.snapshots.find((snapshot) => snapshot !== latest);
  const tracking = product.productShops[0];
  const trackingSnapshot = tracking?.snapshots[0];

  const sales = bigIntToNumber(latest?.soldCountTotal) ?? bigIntToNumber(trackingSnapshot?.soldCountTotal) ?? 0;
  const previousSales = bigIntToNumber(previous?.soldCountTotal) ?? sales;
  const growth = serializeGrowth(buildGrowthFromSnapshot(latest ?? null), window?.days ?? 30);


  return {
    id: product.id,
    platformProductId: product.platformProductId,
    title: product.title,
    imageUrl: product.imageUrl,
    productUrl: product.productUrl,
    category: product.category,
    subCategory: product.subCategory,
    shopId: tracking?.shop.id ?? null,
    shopName: tracking?.shop.name ?? 'TikTok Shop',
    shopAvatarUrl: tracking?.shop.avatarUrl ?? null,
    price: decimalToNumber(latest?.price) ?? decimalToNumber(trackingSnapshot?.price) ?? 0,
    minPrice: decimalToNumber(product.minPrice),
    maxPrice: decimalToNumber(product.maxPrice),
    minOriginalPrice: decimalToNumber(product.minOriginalPrice),
    maxOriginalPrice: decimalToNumber(product.maxOriginalPrice),
    stockTotal: latest?.stockTotal ?? product.stockTotal,
    ratingScore: decimalToNumber(latest?.ratingScore ?? product.ratingScore),
    ratingCount: bigIntToNumber(latest?.ratingCount ?? product.ratingCount) ?? 0,
    isAvailable: product.isAvailable,
    variantCount: product.variantCount,
    sellerCount: latest?.sellerCount ?? product.sellerCount,
    sales,
    gmv: decimalToNumber(latest?.gmvTotal) ?? decimalToNumber(trackingSnapshot?.gmvTotal) ?? 0,
    views: bigIntToNumber(latest?.playCount) ?? 0,
    likes: bigIntToNumber(latest?.diggCount) ?? 0,
    shares: bigIntToNumber(latest?.shareCount) ?? 0,
    growthRate: growth.primary.salesGrowthRate || percentChange(sales, previousSales),
    growth,
    lastSeenAt: toIso(product.lastSeenAt),
    capturedAt: toIso(latest?.capturedAt),
    source: latest?.source,
  };
}
interface SnapshotLike {
  capturedAt: Date;
  bucketDate?: Date;
  price: Prisma.Decimal | null;
  soldCountTotal: bigint | null;
  gmvTotal: Prisma.Decimal | null;
  playCount: bigint | null;
  diggCount: bigint | null;
  shareCount: bigint | null;
  commentCount: bigint | null;
}

/**
 * Dựng chuỗi thời gian liên tục (mỗi ngày 1 điểm) cho các metric chính.
 * Ngày không có snapshot sẽ kế thừa giá trị gần nhất (forward-fill).
 */
export function buildMetricSeries(snapshots: SnapshotLike[], days: number): MetricSeries {
  const byDay = new Map<string, SnapshotLike>();

  for (const snapshot of snapshots) {
    byDay.set(isoDateKey(snapshot.bucketDate ?? snapshot.capturedAt), snapshot);
  }

  const sales: MetricPoint[] = [];
  const gmv: MetricPoint[] = [];
  const views: MetricPoint[] = [];
  const likes: MetricPoint[] = [];
  const price: MetricPoint[] = [];

  const lastKnown = { sales: 0, gmv: 0, views: 0, likes: 0, price: 0 };

  for (const day of eachDay(daysAgo(days), new Date())) {
    const key = isoDateKey(day);
    const snapshot = byDay.get(key);

    if (snapshot) {
      lastKnown.sales = bigIntToNumber(snapshot.soldCountTotal) ?? lastKnown.sales;
      lastKnown.gmv = decimalToNumber(snapshot.gmvTotal) ?? lastKnown.gmv;
      lastKnown.views = bigIntToNumber(snapshot.playCount) ?? lastKnown.views;
      lastKnown.likes = bigIntToNumber(snapshot.diggCount) ?? lastKnown.likes;
      lastKnown.price = decimalToNumber(snapshot.price) ?? lastKnown.price;
    }

    sales.push({ date: key, value: roundTo(lastKnown.sales, 0) });
    gmv.push({ date: key, value: roundTo(lastKnown.gmv, 0) });
    views.push({ date: key, value: roundTo(lastKnown.views, 0) });
    likes.push({ date: key, value: roundTo(lastKnown.likes, 0) });
    price.push({ date: key, value: roundTo(lastKnown.price, 0) });
  }

  return { sales, gmv, views, likes, price };
}

export async function getProductDetail(
  productId: number,
  windowDays: number,
  anchor: 'today' | 'yesterday' = 'today',
): Promise<ProductDetail> {
  const days = clampInt(windowDays, 1, SNAPSHOT_WINDOW_DAYS.max, SNAPSHOT_WINDOW_DAYS.default);
  const window = buildAnalyticsWindow(days, new Date(), anchor);

  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      snapshots: {
        where: { bucketDate: { gte: window.currentStart, lte: window.currentEnd } },
        orderBy: { bucketDate: 'asc' },
      },
      variants: { orderBy: [{ price: 'asc' }, { id: 'asc' }] },
      productShops: {
        include: { shop: true, snapshots: { orderBy: { bucketDate: 'desc' }, take: 2 } },
      },
    },
  });

  if (!product) throw AppError.notFound(`Không tìm thấy sản phẩm #${productId}`);

  const allSnapshots = product.snapshots;
  
  // Áp dụng source priority: lấy snapshot ưu tiên nhất theo source
  const preferredSnapshots = getPreferredSnapshotsByDate(allSnapshots);
  const sortedByDate = Array.from(preferredSnapshots.values())
    .sort((a, b) => b.bucketDate.getTime() - a.bucketDate.getTime());
  
  logSourcePreference(sortedByDate, `product_detail_${productId}`);
  
  const latest = sortedByDate[0];
  const previous = sortedByDate[1];
  const primaryTracking = product.productShops[0];
  const primarySnapshot = primaryTracking?.snapshots[0];
  const primaryPreviousSnapshot = primaryTracking?.snapshots[1];

  const sales = bigIntToNumber(latest?.soldCountTotal) ?? bigIntToNumber(primarySnapshot?.soldCountTotal) ?? 0;
  const previousSales =
    bigIntToNumber(previous?.soldCountTotal) ??
    bigIntToNumber(primaryPreviousSnapshot?.soldCountTotal) ??
    sales;

  const historySeries = buildMetricSeries(allSnapshots, days);
  const growth = serializeGrowth(buildGrowthFromSnapshot(latest ?? null), days);

  const [trendVideos, topCreators] = await Promise.all([
    getProductTrendVideos(productId, 6),
    getProductCreators(productId, 10, days, anchor),
  ]);

  return {
    id: product.id,
    platformProductId: product.platformProductId,
    title: product.title,
    description: product.description,
    imageUrl: product.imageUrl,
    productUrl: product.productUrl,
    category: product.category,
    subCategory: product.subCategory,
    currency: product.currency,
    region: product.region,
    shopId: primaryTracking?.shop.id ?? null,
    shopName: primaryTracking?.shop.name ?? 'TikTok Shop',
    shopAvatarUrl: primaryTracking?.shop.avatarUrl ?? null,
    price: decimalToNumber(latest?.price) ?? decimalToNumber(primarySnapshot?.price) ?? 0,
    sales,
    gmv: decimalToNumber(latest?.gmvTotal) ?? decimalToNumber(primarySnapshot?.gmvTotal) ?? 0,
    views: bigIntToNumber(latest?.playCount) ?? 0,
    likes: bigIntToNumber(latest?.diggCount) ?? 0,
    shares: bigIntToNumber(latest?.shareCount) ?? 0,
    comments: bigIntToNumber(latest?.commentCount) ?? 0,
    growthRate: growth.primary.salesGrowthRate || percentChange(sales, previousSales),
    growth,
    soldCount1d: bigIntToNumber(latest?.soldCount1d) ?? growth.metrics.find((m) => m.days === 1)?.salesDiff ?? 0,
    soldCount7d: bigIntToNumber(latest?.soldCount7d) ?? growth.metrics.find((m) => m.days === 7)?.salesDiff ?? 0,
    soldCount30d: bigIntToNumber(latest?.soldCount30d) ?? growth.metrics.find((m) => m.days === 30)?.salesDiff ?? 0,
    soldCount90d: bigIntToNumber(latest?.soldCount90d) ?? growth.metrics.find((m) => m.days === 90)?.salesDiff ?? 0,
    sellerCount: latest?.sellerCount ?? product.sellerCount,
    minPrice: decimalToNumber(product.minPrice),
    maxPrice: decimalToNumber(product.maxPrice),
    minOriginalPrice: decimalToNumber(product.minOriginalPrice),
    maxOriginalPrice: decimalToNumber(product.maxOriginalPrice),
    stockTotal: latest?.stockTotal ?? product.stockTotal,
    ratingScore: decimalToNumber(latest?.ratingScore ?? product.ratingScore),
    ratingCount: bigIntToNumber(latest?.ratingCount ?? product.ratingCount) ?? 0,
    isAvailable: product.isAvailable,
    variantCount: product.variantCount,
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
    topTrendVideo: trendVideos[0] ?? null,
    trendVideos,
    topCreators,
    lastSeenAt: toIso(product.lastSeenAt),
    firstSeenAt: toIso(product.firstSeenAt),
    capturedAt: toIso(latest?.capturedAt),
    shops: product.productShops.map((tracking) => ({
      productShopId: tracking.id,
      shopId: tracking.shop.id,
      name: tracking.shop.name,
      username: tracking.shop.username,
      avatarUrl: tracking.shop.avatarUrl,
      shopUrl: tracking.shop.shopUrl,
      isActive: tracking.isActive,
      price: decimalToNumber(tracking.snapshots[0]?.price) ?? 0,
      sales: bigIntToNumber(tracking.snapshots[0]?.soldCountTotal) ?? 0,
      gmv: decimalToNumber(tracking.snapshots[0]?.gmvTotal) ?? 0,
    })),
    history: historySeries.sales,
    historySeries,
    source: latest?.source,
  };
}
function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every((entry) => typeof entry === 'string');
}

export interface ProductComparisonEntry {
  id: number;
  title: string;
  shopName: string;
  sales: number;
  gmv: number;
  views: number;
}

export async function compareProducts(productIds: number[]): Promise<ProductComparisonEntry[]> {
  const uniqueIds = Array.from(new Set(productIds.filter((id) => Number.isInteger(id) && id > 0))).slice(0, 5);
  if (uniqueIds.length === 0) return [];

  const products = await prisma.product.findMany({
    where: { id: { in: uniqueIds } },
    include: {
      snapshots: { orderBy: { bucketDate: 'desc' }, take: 1 },
      productShops: { include: { shop: { select: { name: true } } }, take: 1 },
    },
  });

  return uniqueIds
    .map((id) => products.find((product) => product.id === id))
    .filter((product): product is NonNullable<typeof product> => Boolean(product))
    .map((product) => {
      const latest = product.snapshots[0];
      return {
        id: product.id,
        title: product.title,
        shopName: product.productShops[0]?.shop.name ?? 'TikTok Shop',
        sales: bigIntToNumber(latest?.soldCountTotal) ?? 0,
        gmv: decimalToNumber(latest?.gmvTotal) ?? 0,
        views: bigIntToNumber(latest?.playCount) ?? 0,
      };
    });
}
