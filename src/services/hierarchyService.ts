import { Prisma } from '@prisma/client';
import prisma from '../config/db.js';
import { SNAPSHOT_WINDOW_DAYS } from '../config/constants.js';
import type {
  CategoryDetail,
  CategoryOverviewResponse,
  CategorySummary,
  HierarchyProduct,
  HierarchyShop,
  HierarchyStats,
  MetricPoint,
  ShopVideoItem,
  SubCategoryDetail,
  SubCategorySummary,
} from '../types/api.js';
import { AppError } from '../utils/errors.js';
import { buildAnalyticsWindow, isoDateKey, type AnalyticsWindow } from '../utils/dates.js';
import {
  bigIntToNumber,
  clampInt,
  decimalToNumber,
  percentChange,
  roundTo,
  safeDivide,
  toOptionalNumber,
} from '../utils/numbers.js';
import { toIso } from '../utils/serializers.js';

/** Giá»›i háº¡n cá»§a sá»‘ phÃ¢n tÃ­ch cáº¥p ngÃ nh Ä‘á»ƒ trÃ¡nh truy váº¥n quÃ¡ lá»›n. */
const MAX_HIERARCHY_DAYS = 180;
const CONTEXT_TTL_MS = 30_000;
const TOP_PRODUCTS = 10;

interface ShopMeta {
  id: number;
  name: string;
  username: string | null;
  avatarUrl: string | null;
}

interface SnapshotEntry {
  productId: number;
  capturedAt: Date;
  dayKey: string;
  category: string;
  subCategory: string;
  title: string;
  imageUrl: string | null;
  productUrl: string | null;
  price: number;
  sales: number;
  gmv: number;
  views: number;
  sellerCount: number;
  shop: ShopMeta | null;
}

interface HierarchyContext {
  days: number;
  window: AnalyticsWindow;
  latestCurrent: SnapshotEntry[];
  previousSalesByProduct: Map<number, number>;
  dailyByDay: Map<string, Map<number, SnapshotEntry>>;
}

const contextCache = new Map<string, { expiresAt: number; promise: Promise<HierarchyContext> }>();

export function resolveWindowDays(raw: unknown): number {
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'today' || normalized === 'hom-nay' || normalized === 'now') return 1;
    if (normalized === 'yesterday' || normalized === '1d') return 1;
    if (normalized === '7d') return 7;
    if (normalized === '30d') return 30;
    if (normalized === '90d') return 90;
  }
  return clampInt(raw, 1, MAX_HIERARCHY_DAYS, SNAPSHOT_WINDOW_DAYS.default);
}

/** Chuyá»ƒn tham sá»‘ query thÃ nh window chuáº©n (bucketDate), há»— trá»£ Ä‘á»§ 5 má»‘c. */
export function resolveHierarchyRange(raw: unknown): { days: number; anchor: 'today' | 'yesterday'; key: string } {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const query = raw as { range?: unknown; days?: unknown; yesterday?: unknown };
    const rawRange = typeof query.range === 'string' ? query.range.trim().toLowerCase() : '';
    if (
      query.yesterday === 'true' ||
      query.yesterday === '1' ||
      rawRange === 'yesterday' ||
      rawRange === 'hom-qua' ||
      rawRange === '1d'
    ) {
      return { days: 1, anchor: 'yesterday', key: 'yesterday' };
    }
    if (rawRange === 'today' || rawRange === 'hom-nay' || rawRange === 'now' || rawRange === 'current') {
      return { days: 1, anchor: 'today', key: 'today' };
    }
    const days = resolveWindowDays(query.range ?? query.days);
    return { days, anchor: 'today', key: days === 1 ? 'today' : `${days}d` };
  }

  const rawRange = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (rawRange === 'today' || rawRange === 'hom-nay' || rawRange === 'now' || rawRange === 'current') {
    return { days: 1, anchor: 'today', key: 'today' };
  }
  if (rawRange === 'yesterday' || rawRange === 'hom-qua' || rawRange === '1d') {
    return { days: 1, anchor: 'yesterday', key: 'yesterday' };
  }
  const days = resolveWindowDays(raw);
  return { days, anchor: 'today', key: days === 1 ? 'today' : `${days}d` };
}

/* ------------------------------------------------------------------ */
/* Náº¡p dá»¯ liá»‡u ná»n cho má»™t cá»­a sá»• thá»i gian                            */
/* ------------------------------------------------------------------ */

interface RawRow {
  id: number;
  title: string;
  imageUrl: string | null;
  productUrl: string | null;
  category: string | null;
  subCategory: string | null;
  sellerCount: number | string | null;
  soldCountTotal: bigint | string | null;
  gmvTotal: Prisma.Decimal | string | null;
  playCount: bigint | string | null;
  price: Prisma.Decimal | string | null;
  prevSales: bigint | string | null;
  shopId: number | null;
  shopName: string | null;
  shopUsername: string | null;
  shopAvatarUrl: string | null;
  capturedAt: Date;
  bucketDate: Date;
}

async function buildContext(days: number, anchor: 'today' | 'yesterday' = 'today'): Promise<HierarchyContext> {
  const window = buildAnalyticsWindow(days, new Date(), anchor);

  const rows = await prisma.$queryRaw<RawRow[]>`
    WITH current_latest AS (
      SELECT DISTINCT ON (ps."productId")
        ps."productId",
        ps."soldCountTotal",
        ps."gmvTotal",
        ps."playCount",
        ps."price",
        ps."capturedAt",
        ps."bucketDate"
      FROM "ProductSnapshot" ps
      WHERE ps."bucketDate" >= ${window.currentStart} AND ps."bucketDate" <= ${window.currentEnd}
      ORDER BY ps."productId", ps."bucketDate" DESC, ps."id" DESC
    ),
    prev_latest AS (
      SELECT DISTINCT ON (ps."productId")
        ps."productId",
        ps."soldCountTotal"
      FROM "ProductSnapshot" ps
      WHERE ps."bucketDate" >= ${window.previousStart} AND ps."bucketDate" <= ${window.previousEnd}
      ORDER BY ps."productId", ps."bucketDate" DESC, ps."id" DESC
    )
    SELECT
      p."id",
      p."title",
      p."imageUrl",
      p."productUrl",
      p."category",
      p."subCategory",
      p."sellerCount",
      c."soldCountTotal",
      c."gmvTotal",
      c."playCount",
      c."price",
      c."capturedAt",
      c."bucketDate",
      prev."soldCountTotal" AS "prevSales",
      s."id" AS "shopId",
      s."name" AS "shopName",
      s."username" AS "shopUsername",
      s."avatarUrl" AS "shopAvatarUrl"
    FROM current_latest c
    JOIN "Product" p ON p."id" = c."productId"
    LEFT JOIN prev_latest prev ON prev."productId" = c."productId"
    LEFT JOIN LATERAL (
      SELECT sh."id", sh."name", sh."username", sh."avatarUrl"
      FROM "ProductShop" ps2
      JOIN "Shop" sh ON sh."id" = ps2."shopId"
      WHERE ps2."productId" = p."id" AND ps2."isActive" = true
      ORDER BY ps2."lastSeenAt" DESC
      LIMIT 1
    ) s ON true
    ORDER BY c."bucketDate" ASC
  `;

  const latestCurrent: SnapshotEntry[] = [];
  const previousSalesByProduct = new Map<number, number>();
  const dailyByDay = new Map<string, Map<number, SnapshotEntry>>();

  for (const row of rows) {
    const entry: SnapshotEntry = {
      productId: row.id,
      capturedAt: row.capturedAt,
      dayKey: isoDateKey(row.bucketDate),
      category: row.category ?? 'KhÃ¡c',
      subCategory: row.subCategory ?? 'Tá»•ng há»£p',
      title: row.title,
      imageUrl: row.imageUrl,
      productUrl: row.productUrl,
      price: decimalToNumber(asDecimal(row.price)) ?? 0,
      sales: bigIntToNumber(asBigInt(row.soldCountTotal)) ?? 0,
      gmv: decimalToNumber(asDecimal(row.gmvTotal)) ?? 0,
      views: bigIntToNumber(asBigInt(row.playCount)) ?? 0,
      sellerCount: toOptionalNumber(row.sellerCount) ?? 0,
      shop:
        row.shopId === null
          ? null
          : {
              id: row.shopId,
              name: row.shopName ?? 'TikTok Shop',
              username: row.shopUsername,
              avatarUrl: row.shopAvatarUrl,
            },
    };

    latestCurrent.push(entry);

    const prev = bigIntToNumber(asBigInt(row.prevSales));
    if (prev !== null) previousSalesByProduct.set(entry.productId, prev);

    let bucket = dailyByDay.get(entry.dayKey);
    if (!bucket) {
      bucket = new Map<number, SnapshotEntry>();
      dailyByDay.set(entry.dayKey, bucket);
    }
    bucket.set(entry.productId, entry);
  }

  return { days, window, latestCurrent, previousSalesByProduct, dailyByDay };
}

function asBigInt(value: bigint | string | number | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? BigInt(Math.trunc(value)) : null;
  const trimmed = value.trim();
  return /^-?\d+$/.test(trimmed) ? BigInt(trimmed) : null;
}

function asDecimal(value: Prisma.Decimal | string | number | null | undefined): Prisma.Decimal | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Prisma.Decimal) return value;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? new Prisma.Decimal(numeric) : null;
}

async function loadContext(days: number, anchor: 'today' | 'yesterday' = 'today'): Promise<HierarchyContext> {
  const now = Date.now();
  const key = `${days}:${anchor}`;
  const cached = contextCache.get(key);

  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = buildContext(days, anchor);
  contextCache.set(key, { expiresAt: now + CONTEXT_TTL_MS, promise });
  promise.catch(() => contextCache.delete(key));

  return promise;
}

/* ------------------------------------------------------------------ */
/* Tá»•ng há»£p sá»‘ liá»‡u                                                    */
/* ------------------------------------------------------------------ */

function computeStats(entries: SnapshotEntry[], previousSales: Map<number, number>): HierarchyStats {
  let totalSales = 0;
  let totalGmv = 0;
  let totalViews = 0;
  let priceSum = 0;
  let priceCount = 0;
  let comparableCurrent = 0;
  let comparablePrevious = 0;
  const shops = new Set<number>();

  for (const entry of entries) {
    totalSales += entry.sales;
    totalGmv += entry.gmv;
    totalViews += entry.views;
    if (entry.price > 0) {
      priceSum += entry.price;
      priceCount += 1;
    }
    if (entry.shop) shops.add(entry.shop.id);

    const previous = previousSales.get(entry.productId);
    if (previous !== undefined) {
      comparableCurrent += entry.sales;
      comparablePrevious += previous;
    }
  }

  return {
    productCount: entries.length,
    shopCount: shops.size,
    totalSales,
    totalGmv: roundTo(totalGmv, 0),
    totalViews,
    avgPrice: priceCount > 0 ? roundTo(safeDivide(priceSum, priceCount), 0) : 0,
    growthRate: comparablePrevious > 0 ? percentChange(comparableCurrent, comparablePrevious) : 0,
  };
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

function toHierarchyProduct(entry: SnapshotEntry): HierarchyProduct {
  return {
    id: entry.productId,
    title: entry.title,
    imageUrl: entry.imageUrl,
    productUrl: entry.productUrl,
    shopId: entry.shop?.id ?? null,
    shopName: entry.shop?.name ?? 'TikTok Shop',
    price: entry.price,
    sales: entry.sales,
    gmv: entry.gmv,
    views: entry.views,
    sellerCount: entry.sellerCount,
    category: entry.category,
    subCategory: entry.subCategory,
  };
}

function topProducts(entries: SnapshotEntry[], limit = TOP_PRODUCTS): HierarchyProduct[] {
  return [...entries]
    .sort((a, b) => b.gmv - a.gmv)
    .slice(0, limit)
    .map(toHierarchyProduct);
}

function buildTimeline(context: HierarchyContext, predicate: (entry: SnapshotEntry) => boolean): MetricPoint[] {
  // Snapshot lÆ°u GMV luá»¹ káº¿ => tÃ­nh phÃ¡t sinh theo ngÃ y báº±ng delta giá»¯a cÃ¡c má»‘c.
  const byProduct = new Map<number, Map<string, number>>();

  for (const [dayKey, bucket] of context.dailyByDay.entries()) {
    for (const entry of bucket.values()) {
      if (!predicate(entry)) continue;
      let series = byProduct.get(entry.productId);
      if (!series) {
        series = new Map<string, number>();
        byProduct.set(entry.productId, series);
      }
      series.set(dayKey, entry.gmv);
    }
  }

  const daily = new Map<string, number>();
  for (const series of byProduct.values()) {
    let previous: number | null = null;
    for (const day of context.window.daysList) {
      const key = isoDateKey(day);
      const gmv = series.get(key);
      if (gmv === undefined) continue;
      if (previous !== null) daily.set(key, (daily.get(key) ?? 0) + Math.max(0, gmv - previous));
      previous = gmv;
    }
  }

  return context.window.daysList.map((day) => {
    const key = isoDateKey(day);
    return { date: key, value: roundTo(daily.get(key) ?? 0, 0) };
  });
}

function share(part: number, total: number): number {
  return total > 0 ? roundTo((part / total) * 100, 2) : 0;
}

/* ------------------------------------------------------------------ */
/* Cáº¥p 1: Danh sÃ¡ch + tá»•ng quan ngÃ nh hÃ ng                             */
/* ------------------------------------------------------------------ */

export async function getCategoryOverview(rawDays: unknown): Promise<CategoryOverviewResponse> {
  const resolved = resolveHierarchyRange(rawDays);
  const days = resolved.days;
  const context = await loadContext(days, resolved.anchor);
  const categories = await listCategories(rawDays);

  const totals = categories.reduce(
    (acc, item) => ({
      gmv: acc.gmv + item.totalGmv,
      sales: acc.sales + item.totalSales,
      products: acc.products + item.productCount,
      shops: acc.shops + item.shopCount,
      comparableCurrent: acc.comparableCurrent + (item.comparableSales ?? 0),
      comparablePrevious: acc.comparablePrevious + (item.comparablePreviousSales ?? 0),
    }),
    { gmv: 0, sales: 0, products: 0, shops: 0, comparableCurrent: 0, comparablePrevious: 0 },
  );

  return {
    range: {
      key:
        days === 1
          ? resolved.anchor === 'yesterday'
            ? 'yesterday'
            : 'today'
          : `${days}d`,
      label:
        days === 1
          ? resolved.anchor === 'yesterday'
            ? 'Hôm qua'
            : 'Hôm nay'
          : `${days} ngày qua`,
      days,
    },
    overview: {
      categoryCount: categories.length,
      totalGmv: roundTo(totals.gmv, 0),
      totalSales: totals.sales,
      totalProducts: context.latestCurrent.length,
      totalShops: new Set(context.latestCurrent.map((entry) => entry.shop?.id).filter(Boolean)).size,
      growthRate:
        totals.comparablePrevious > 0
          ? percentChange(totals.comparableCurrent, totals.comparablePrevious)
          : 0,
    },
    categories,
  };
}

export async function listCategories(rawDays: unknown): Promise<CategorySummary[]> {
  const resolved = resolveHierarchyRange(rawDays);
  const context = await loadContext(resolved.days, resolved.anchor);

  const groups = groupBy(context.latestCurrent, (entry) => entry.category);
  const totalGmv = context.latestCurrent.reduce((sum, entry) => sum + entry.gmv, 0);

  const summaries: CategorySummary[] = [];

  for (const [name, entries] of groups) {
    const stats = computeStats(entries, context.previousSalesByProduct);
    const subGroups = groupBy(entries, (entry) => entry.subCategory);
    const topSubCategory = Array.from(subGroups.entries())
      .map(([subName, subEntries]) => ({
        name: subName,
        gmv: subEntries.reduce((sum, entry) => sum + entry.gmv, 0),
      }))
      .sort((a, b) => b.gmv - a.gmv)[0];

    const comparable = comparableSales(entries, context.previousSalesByProduct);

    summaries.push({
      ...stats,
      name,
      shareOfGmv: share(stats.totalGmv, totalGmv),
      topSubCategory: topSubCategory?.name ?? null,
      comparableSales: comparable.current,
      comparablePreviousSales: comparable.previous,
    });
  }

  return summaries.sort((a, b) => b.totalGmv - a.totalGmv);
}

function comparableSales(entries: SnapshotEntry[], previousSales: Map<number, number>): { current: number; previous: number } {
  let current = 0;
  let previous = 0;
  for (const entry of entries) {
    const prev = previousSales.get(entry.productId);
    if (prev === undefined) continue;
    current += entry.sales;
    previous += prev;
  }
  return { current, previous };
}

/* ------------------------------------------------------------------ */
/* Cáº¥p 2: Chi tiáº¿t ngÃ nh chÃ­nh -> danh sÃ¡ch ngÃ nh con                  */
/* ------------------------------------------------------------------ */

export async function getCategoryDetail(categoryName: string, rawDays: unknown): Promise<CategoryDetail> {
  const resolved = resolveHierarchyRange(rawDays);
  const context = await loadContext(resolved.days, resolved.anchor);
  const normalized = categoryName.trim();

  const entries = context.latestCurrent.filter((entry) => entry.category === normalized);
  if (entries.length === 0) throw AppError.notFound(`KhÃ´ng tÃ¬m tháº¥y ngÃ nh hÃ ng "${normalized}"`);

  const stats = computeStats(entries, context.previousSalesByProduct);
  const subGroups = groupBy(entries, (entry) => entry.subCategory);

  const subCategories: SubCategorySummary[] = Array.from(subGroups.entries())
    .map(([name, subEntries]) => {
      const subStats = computeStats(subEntries, context.previousSalesByProduct);
      const comparable = comparableSales(subEntries, context.previousSalesByProduct);
      return {
        ...subStats,
        name,
        category: normalized,
        shareOfGmv: share(
          subEntries.reduce((sum, entry) => sum + entry.gmv, 0),
          stats.totalGmv,
        ),
        comparableSales: comparable.current,
        comparablePreviousSales: comparable.previous,
      };
    })
    .sort((a, b) => b.totalGmv - a.totalGmv);

  return {
    ...stats,
    category: normalized,
    subCategories,
    timeline: buildTimeline(context, (entry) => entry.category === normalized),
    topProducts: topProducts(entries),
  };
}

/* ------------------------------------------------------------------ */
/* Cáº¥p 3: Chi tiáº¿t ngÃ nh con -> top shop dáº«n Ä‘áº§u                       */
/* ------------------------------------------------------------------ */

export async function getSubCategoryDetail(
  categoryName: string,
  subCategoryName: string,
  rawDays: unknown,
): Promise<SubCategoryDetail> {
  const resolved = resolveHierarchyRange(rawDays);
  const context = await loadContext(resolved.days, resolved.anchor);
  const category = categoryName.trim();
  const subCategory = subCategoryName.trim();

  const entries = context.latestCurrent.filter(
    (entry) => entry.category === category && entry.subCategory === subCategory,
  );
  if (entries.length === 0) {
    throw AppError.notFound(`KhÃ´ng tÃ¬m tháº¥y ngÃ nh con "${subCategory}" thuá»™c "${category}"`);
  }

  const stats = computeStats(entries, context.previousSalesByProduct);
  const shopGroups = groupBy(entries, (entry) => String(entry.shop?.id ?? 0));

  const shops: HierarchyShop[] = Array.from(shopGroups.entries())
    .filter(([shopId]) => shopId !== '0')
    .map(([, shopEntries]) => {
      const shop = shopEntries[0]?.shop;
      const shopStats = computeStats(shopEntries, context.previousSalesByProduct);
      return {
        id: shop?.id ?? 0,
        name: shop?.name ?? 'TikTok Shop',
        username: shop?.username ?? null,
        avatarUrl: shop?.avatarUrl ?? null,
        productCount: shopStats.productCount,
        totalSales: shopStats.totalSales,
        totalGmv: shopStats.totalGmv,
        totalViews: shopStats.totalViews,
        avgPrice: shopStats.avgPrice,
        growthRate: shopStats.growthRate,
      };
    })
    .sort((a, b) => b.totalGmv - a.totalGmv);

  return {
    ...stats,
    category,
    subCategory,
    shops,
    timeline: buildTimeline(context, (entry) => entry.category === category && entry.subCategory === subCategory),
    topProducts: topProducts(entries),
  };
}

/* ------------------------------------------------------------------ */
/* Cáº¥p 4: Video xu hÆ°á»›ng gá»‘c cá»§a má»™t shop                              */
/* ------------------------------------------------------------------ */

export async function getShopVideos(shopId: number, rawLimit: unknown): Promise<ShopVideoItem[]> {
  const limit = clampInt(rawLimit, 1, 50, 12);

  const shop = await prisma.shop.findUnique({ where: { id: shopId }, select: { id: true } });
  if (!shop) throw AppError.notFound(`KhÃ´ng tÃ¬m tháº¥y shop #${shopId}`);

  const rows = await prisma.productSnapshot.findMany({
    where: {
      playCount: { not: null },
      product: { productShops: { some: { shopId, isActive: true } } },
    },
    select: {
      productId: true,
      capturedAt: true,
      playCount: true,
      diggCount: true,
      shareCount: true,
      commentCount: true,
      price: true,
      soldCountTotal: true,
      gmvTotal: true,
      product: {
        select: { title: true, imageUrl: true, productUrl: true, category: true, subCategory: true },
      },
    },
    orderBy: { capturedAt: 'desc' },
    take: limit * 8,
  });

  const latestPerProduct = new Map<number, (typeof rows)[number]>();

  for (const row of rows) {
    const playCount = bigIntToNumber(row.playCount) ?? 0;
    if (playCount <= 0) continue;

    const existing = latestPerProduct.get(row.productId);
    if (!existing) {
      latestPerProduct.set(row.productId, row);
      continue;
    }

    const existingPlay = bigIntToNumber(existing.playCount) ?? 0;
    if (playCount > existingPlay) latestPerProduct.set(row.productId, row);
  }

  return Array.from(latestPerProduct.values())
    .map<ShopVideoItem>((row) => ({
      productId: row.productId,
      title: row.product.title,
      imageUrl: row.product.imageUrl,
      videoUrl: row.product.productUrl,
      category: row.product.category,
      subCategory: row.product.subCategory,
      price: decimalToNumber(row.price) ?? 0,
      sales: bigIntToNumber(row.soldCountTotal) ?? 0,
      gmv: decimalToNumber(row.gmvTotal) ?? 0,
      playCount: bigIntToNumber(row.playCount) ?? 0,
      diggCount: bigIntToNumber(row.diggCount) ?? 0,
      shareCount: bigIntToNumber(row.shareCount) ?? 0,
      commentCount: bigIntToNumber(row.commentCount) ?? 0,
      capturedAt: toIso(row.capturedAt),
    }))
    .sort((a, b) => b.playCount - a.playCount)
    .slice(0, limit);
}
