import type { Prisma } from '@prisma/client';
import prisma from '../../config/db.js';
import { bigIntToNumber, decimalToNumber, roundTo, safeDivide } from '../../utils/numbers.js';
import {
  buildMultiPeriodAggregate,
  createAccumulator,
  accumulate,
  currentAnchor,
  periodWindows,
  valueAt,
} from './metrics.js';
import { buildProductGrowth, toCumulativePoint, toProductCard } from './commerceRepository.js';
import type {
  MultiPeriodMetrics,
  RangeMeta,
  ShopCommerceCategoryCard,
  ShopCommerceCategoryDetail,
  ShopCommerceProductCard,
} from './shopCommerceTypes.js';

const REGION = 'VN';
const TOP_PRODUCTS = 10;
const EMPTY_LABEL = 'Khác';

interface CategoryEntry {
  productId: number;
  category: string;
  subCategory: string;
  shopId: number | null;
  card: ShopCommerceProductCard;
  series: ReturnType<typeof toCumulativePoint>[];
}

interface CategoryContext {
  entries: CategoryEntry[];
  windows: ReturnType<typeof periodWindows>;
  now: Date;
  range: RangeMeta;
}

/**
 * Nạp toàn bộ sản phẩm VN kèm snapshot (tối đa 2x90 ngày) để tính ngành hàng.
 * Dữ liệu được cache ngắn theo (range) để nhiều request cùng lúc không truy vấn lặp.
 */
const contextCache = new Map<string, { expiresAt: number; promise: Promise<CategoryContext> }>();
const CONTEXT_TTL_MS = 20_000;

async function loadCategoryContext(now: Date, range: RangeMeta): Promise<CategoryContext> {
  const cacheKey = `${now.toISOString().slice(0, 10)}:${range.key}:${range.days}:${range.anchor}`;
  const cached = contextCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const promise = buildCategoryContext(now, range);
  contextCache.set(cacheKey, { expiresAt: Date.now() + CONTEXT_TTL_MS, promise });
  promise.catch(() => contextCache.delete(cacheKey));

  return promise;
}

async function buildCategoryContext(now: Date, range: RangeMeta): Promise<CategoryContext> {
  const windows = periodWindows(now, range.anchor);
  const lookback = windows[windows.length - 1];

  const products = await prisma.product.findMany({
    where: { region: REGION },
    include: {
      productShops: {
        where: { isActive: true },
        orderBy: { lastSeenAt: 'desc' },
        take: 1,
        select: { shop: { select: { id: true, name: true, avatarUrl: true } } },
      },
      snapshots: {
        where: { bucketDate: { gte: lookback?.previousBase ?? now } },
        select: {
          bucketDate: true,
          capturedAt: true,
          price: true,
          soldCountTotal: true,
          gmvTotal: true,
          stockTotal: true,
          ratingScore: true,
          ratingCount: true,
          playCount: true,
          diggCount: true,
          shareCount: true,
          commentCount: true,
        },
        orderBy: { bucketDate: 'asc' },
      },
    },
  });

  const entries: CategoryEntry[] = products.map((product) => {
    const series = product.snapshots.map(toCumulativePoint);
    const latest = valueAt(series, currentAnchor(now, range.anchor));
    const bundle = { productId: product.id, series, latest, previous: null };
    const growth = buildProductGrowth(bundle, now, range);

    return {
      productId: product.id,
      category: product.category ?? EMPTY_LABEL,
      subCategory: product.subCategory ?? 'Tổng hợp',
      shopId: product.productShops[0]?.shop.id ?? null,
      card: toProductCard(product, bundle, growth),
      series,
    };
  });

  return { entries, windows, now, range };
}

function summarize(
  entries: ReadonlyArray<CategoryEntry>,
  context: CategoryContext,
): {
  stats: Omit<ShopCommerceCategoryCard, 'name' | 'shareOfGmv' | 'topSubCategory' | 'growth'>;
  growth: MultiPeriodMetrics;
} {
  let totalGmv = 0;
  let totalSales = 0;
  let totalViews = 0;
  let priceSum = 0;
  let priceCount = 0;
  const shops = new Set<number>();

  const accumulators = new Map<number, ReturnType<typeof createAccumulator>>();
  for (const window of context.windows) accumulators.set(window.days, createAccumulator());

  for (const entry of entries) {
    const latest = valueAt(entry.series, currentAnchor(context.now, context.range.anchor));
    if (latest) {
      totalGmv += latest.gmv;
      totalSales += latest.sold;
      totalViews += latest.playCount;
      if (latest.price > 0) {
        priceSum += latest.price;
        priceCount += 1;
      }
    }
    if (entry.shopId) shops.add(entry.shopId);

    for (const window of context.windows) {
      const acc = accumulators.get(window.days);
      if (acc) accumulate(acc, entry.series, window);
    }
  }

  const growth = buildMultiPeriodAggregate(accumulators, context.windows, context.range.days);

  return {
    stats: {
      productCount: entries.length,
      shopCount: shops.size,
      totalGmv: roundTo(totalGmv, 0),
      totalSales,
      totalViews,
      avgPrice: priceCount > 0 ? roundTo(safeDivide(priceSum, priceCount), 0) : 0,
      growthRate: growth.primary.gmv.growthRate,
    },
    growth,
  };
}

export async function listCommerceCategories(now: Date, range: RangeMeta): Promise<ShopCommerceCategoryCard[]> {
  const context = await loadCategoryContext(now, range);
  const groups = groupBy(context.entries, (entry) => entry.category);
  const totalGmv = context.entries.reduce((sum, entry) => {
    const latest = valueAt(entry.series, currentAnchor(context.now, context.range.anchor));
    return sum + (latest?.gmv ?? 0);
  }, 0);

  return [...groups.entries()]
    .map(([name, entries]) => {
      const { stats, growth } = summarize(entries, context);
      const subGroups = groupBy(entries, (entry) => entry.subCategory);
      const topSubCategory =
        [...subGroups.entries()]
          .map(([subName, subEntries]) => ({
            name: subName,
            gmv: subEntries.reduce(
              (sum, entry) => sum + (valueAt(entry.series, currentAnchor(context.now, context.range.anchor))?.gmv ?? 0),
              0,
            ),
          }))
          .sort((a, b) => b.gmv - a.gmv)[0]?.name ?? null;

      return {
        name,
        ...stats,
        shareOfGmv: totalGmv > 0 ? roundTo((stats.totalGmv / totalGmv) * 100, 2) : 0,
        growth,
        topSubCategory,
      };
    })
    .sort((a, b) => b.totalGmv - a.totalGmv);
}

export async function getCommerceCategoryDetail(
  categoryName: string,
  now: Date,
  range: RangeMeta,
): Promise<ShopCommerceCategoryDetail> {
  const context = await loadCategoryContext(now, range);
  const normalized = categoryName.trim();
  const entries = context.entries.filter((entry) => entry.category === normalized);

  if (entries.length === 0) {
    const error = new Error(`Không tìm thấy ngành hàng "${normalized}"`);
    (error as Error & { statusCode?: number; code?: string }).statusCode = 404;
    (error as Error & { code?: string }).code = 'NOT_FOUND';
    throw error;
  }

  const { stats, growth } = summarize(entries, context);
  const subGroups = groupBy(entries, (entry) => entry.subCategory);

  const subCategories = [...subGroups.entries()]
    .map(([name, subEntries]) => {
      const sub = summarize(subEntries, context);
      return {
        name,
        category: normalized,
        ...sub.stats,
        shareOfGmv: stats.totalGmv > 0 ? roundTo((sub.stats.totalGmv / stats.totalGmv) * 100, 2) : 0,
        growth: sub.growth,
        topSubCategory: null,
      };
    })
    .sort((a, b) => b.totalGmv - a.totalGmv);

  return {
    name: normalized,
    ...stats,
    shareOfGmv: 100,
    growth,
    topSubCategory: subCategories[0]?.name ?? null,
    subCategories,
    timeline: buildCategoryTimeline(entries, context),
    topProducts: [...entries]
      .sort((a, b) => b.card.gmv - a.card.gmv)
      .slice(0, TOP_PRODUCTS)
      .map((entry) => entry.card),
  };
}

function buildCategoryTimeline(
  entries: readonly CategoryEntry[],
  context: CategoryContext,
): Array<{ date: string; value: number }> {
  const daily = new Map<string, number>();

  for (const entry of entries) {
    let previous: number | null = null;
    for (const point of entry.series) {
      const key = point.bucketDate.toISOString().slice(0, 10);
      if (previous !== null) daily.set(key, (daily.get(key) ?? 0) + Math.max(0, point.gmv - previous));
      previous = point.gmv;
    }
  }

  return [...daily.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-Math.max(7, context.range.days))
    .map(([date, value]) => ({ date, value: roundTo(value, 0) }));
}

function groupBy<T>(items: readonly T[], selector: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = selector(item);
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

export { bigIntToNumber, decimalToNumber, type Prisma };
