import type { Prisma } from '@prisma/client';
import prisma from '../config/db.js';
import { SNAPSHOT_WINDOW_DAYS } from '../config/constants.js';
import type {
  CategoryTrendDetail,
  CategoryTrendMetrics,
  CategoryTrendOverview,
  CategoryTrendSummary,
  TrendComparison,
  TrendComparisonRow,
  TrendDirection,
  TrendHashtagItem,
  TrendMetric,
  TrendPeriod,
  TrendSoundItem,
  TrendTimelinePoint,
  TrendTopProduct,
  TrendTotals,
  TrendVideoItem,
} from '../types/trend.js';
import { AppError } from '../utils/errors.js';
import { addDays, isValidDate, isoDateKey, startOfUtcDay } from '../utils/dates.js';
import {
  bigIntToNumber,
  clampInt,
  decimalToNumber,
  percentChange,
  roundTo,
  safeDivide,
} from '../utils/numbers.js';
import { toIso } from '../utils/serializers.js';
import { DEFAULT_CATEGORY, DEFAULT_SUB_CATEGORY } from '../config/taxonomy.js';

/* ------------------------------------------------------------------ */
/* Cấu hình                                                            */
/* ------------------------------------------------------------------ */

const MAX_TREND_DAYS = 180;
const MAX_PERIODS = 6;
const DEFAULT_PERIODS = 2;
const CONTEXT_TTL_MS = 30_000;

/** Ngưỡng (% thay đổi) để coi là "đang lên" / "đang tụt" thay vì đi ngang. */
const FLAT_THRESHOLD_PERCENT = 0.5;

/* ------------------------------------------------------------------ */
/* Kiểu nội bộ                                                         */
/* ------------------------------------------------------------------ */

interface ShopMeta {
  id: number;
  name: string;
}

interface ProductMeta {
  title: string;
  imageUrl: string | null;
  productUrl: string | null;
  category: string;
  subCategory: string;
  price: number;
  shop: ShopMeta | null;
}

interface SnapshotEntry extends ProductMeta {
  productId: number;
  bucketDate: Date;
  dayKey: string;
  periodIndex: number;
  sales: number;
  gmv: number;
  views: number;
  likes: number;
  shares: number;
  comments: number;
  hashtags: string[];
  soundName: string | null;
  soundAuthor: string | null;
}

interface TrendContext {
  days: number;
  periodCount: number;
  anchor: Date;
  periods: TrendPeriod[];
  /** [periodIndex] -> Map<productId, SnapshotEntry> (bản ghi mới nhất trong kỳ) */
  latestByPeriod: Map<number, Map<number, SnapshotEntry>>;
  /** [dayKey] -> Map<productId, SnapshotEntry> (chỉ kỳ hiện tại) */
  dailyByDay: Map<string, Map<number, SnapshotEntry>>;
  daysList: Date[];
}

const contextCache = new Map<string, { expiresAt: number; promise: Promise<TrendContext> }>();

/* ------------------------------------------------------------------ */
/* Chuẩn bị tham số                                                    */
/* ------------------------------------------------------------------ */

function resolveDays(raw: unknown): number {
  return clampInt(raw, 1, MAX_TREND_DAYS, SNAPSHOT_WINDOW_DAYS.default);
}

function resolvePeriodCount(raw: unknown): number {
  return clampInt(raw, 2, MAX_PERIODS, DEFAULT_PERIODS);
}

function buildPeriods(anchor: Date, days: number, count: number): TrendPeriod[] {
  // Kỳ 0 = hiện tại (mới nhất), kỳ 1 = trước đó, ...
  return Array.from({ length: count }, (_item, index) => {
    const end = addDays(anchor, -index * days);
    const start = addDays(end, -(days - 1));
    return {
      index,
      label:
        index === 0
          ? `Kỳ hiện tại (${isoDateKey(start)} → ${isoDateKey(end)})`
          : `Kỳ -${index} (${isoDateKey(start)} → ${isoDateKey(end)})`,
      start: isoDateKey(start),
      end: isoDateKey(end),
      days,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Truy vấn & tổng hợp dữ liệu nền                                     */
/* ------------------------------------------------------------------ */

/**
 * Mốc neo phân tích xu hướng.
 * - 'latest' (mặc định): ngày snapshot mới nhất trong DB (an toàn khi dữ liệu trễ).
 * - 'today' / 'yesterday': mốc thời gian thực theo yêu cầu bộ lọc.
 */
async function resolveAnchor(mode: 'latest' | 'today' | 'yesterday' = 'latest'): Promise<Date> {
  const todayStart = startOfUtcDay(new Date());
  if (mode === 'today') return todayStart;
  if (mode === 'yesterday') return addDays(todayStart, -1);

  const latest = await prisma.productSnapshot.findFirst({
    orderBy: { bucketDate: 'desc' },
    select: { bucketDate: true },
  });

  const candidate = latest?.bucketDate;
  return candidate && isValidDate(candidate) ? startOfUtcDay(candidate) : todayStart;
}

/** Nhận diện mốc neo from query: range=today|yesterday hoặc mặc định latest. */
function resolveAnchorMode(rawDays: unknown, rawRange?: unknown): 'latest' | 'today' | 'yesterday' {
  const raw = typeof rawRange === 'string' ? rawRange.trim().toLowerCase() : '';
  if (raw === 'today' || raw === 'hom-nay' || raw === 'now' || raw === 'current') return 'today';
  if (raw === 'yesterday' || raw === 'hom-qua') return 'yesterday';
  if (typeof rawDays === 'string') {
    const normalized = rawDays.trim().toLowerCase();
    if (normalized === 'today' || normalized === 'hom-nay') return 'today';
    if (normalized === 'yesterday' || normalized === 'hom-qua') return 'yesterday';
  }
  return 'latest';
}

function readHashtags(rawData: Prisma.JsonValue | null): string[] {
  if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) return [];
  const value = (rawData as Record<string, unknown>).hashtags;
  if (!Array.isArray(value)) return [];

  const tags: string[] = [];
  for (const item of value) {
    if (typeof item === 'string') {
      const tag = item.trim().replace(/^#/, '').toLowerCase();
      if (tag) tags.push(tag);
    } else if (item && typeof item === 'object') {
      const name = (item as Record<string, unknown>).name;
      if (typeof name === 'string') {
        const tag = name.trim().replace(/^#/, '').toLowerCase();
        if (tag) tags.push(tag);
      }
    }
  }

  return Array.from(new Set(tags)).slice(0, 30);
}

function readSound(rawData: Prisma.JsonValue | null): { name: string | null; author: string | null } {
  if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) {
    return { name: null, author: null };
  }

  const music = (rawData as Record<string, unknown>).music;
  if (!music || typeof music !== 'object' || Array.isArray(music)) {
    return { name: null, author: null };
  }

  const record = music as Record<string, unknown>;
  const name = typeof record.musicName === 'string' ? record.musicName.trim() : '';
  const author = typeof record.musicAuthor === 'string' ? record.musicAuthor.trim() : '';

  return { name: name || null, author: author || null };
}

async function buildContext(
  days: number,
  periodCount: number,
  anchorMode: 'latest' | 'today' | 'yesterday' = 'latest',
): Promise<TrendContext> {
  const anchor = await resolveAnchor(anchorMode);
  const periods = buildPeriods(anchor, days, periodCount);
  const oldestStart = addDays(anchor, -((periodCount * days) - 1));

  const rows = await prisma.productSnapshot.findMany({
    where: { bucketDate: { gte: oldestStart, lte: anchor } },
    select: {
      productId: true,
      bucketDate: true,
      soldCountTotal: true,
      gmvTotal: true,
      playCount: true,
      diggCount: true,
      shareCount: true,
      commentCount: true,
      price: true,
      rawData: true,
      product: {
        select: {
          title: true,
          imageUrl: true,
          productUrl: true,
          category: true,
          subCategory: true,
          productShops: {
            where: { isActive: true },
            orderBy: { lastSeenAt: 'desc' },
            take: 1,
            select: { shop: { select: { id: true, name: true } } },
          },
        },
      },
    },
    orderBy: [{ bucketDate: 'asc' }, { capturedAt: 'asc' }],
  });

  const latestByPeriod = new Map<number, Map<number, SnapshotEntry>>();
  for (let index = 0; index < periodCount; index += 1) {
    latestByPeriod.set(index, new Map<number, SnapshotEntry>());
  }
  const dailyByDay = new Map<string, Map<number, SnapshotEntry>>();
  const currentStart = addDays(anchor, -(days - 1));

  for (const row of rows) {
    if (!isValidDate(row.bucketDate)) continue;

    const bucketDate = startOfUtcDay(row.bucketDate);
    if (bucketDate > anchor) continue;

    const periodIndex = Math.floor((anchor.getTime() - bucketDate.getTime()) / (days * 86_400_000));
    if (periodIndex < 0 || periodIndex >= periodCount) continue;

    const sound = readSound(row.rawData);
    const entry: SnapshotEntry = {
      productId: row.productId,
      bucketDate,
      dayKey: isoDateKey(bucketDate),
      periodIndex,
      category: row.product.category?.trim() || DEFAULT_CATEGORY,
      subCategory: row.product.subCategory?.trim() || DEFAULT_SUB_CATEGORY,
      title: row.product.title,
      imageUrl: row.product.imageUrl,
      productUrl: row.product.productUrl,
      price: decimalToNumber(row.price) ?? 0,
      sales: bigIntToNumber(row.soldCountTotal) ?? 0,
      gmv: decimalToNumber(row.gmvTotal) ?? 0,
      views: bigIntToNumber(row.playCount) ?? 0,
      likes: bigIntToNumber(row.diggCount) ?? 0,
      shares: bigIntToNumber(row.shareCount) ?? 0,
      comments: bigIntToNumber(row.commentCount) ?? 0,
      hashtags: readHashtags(row.rawData),
      soundName: sound.name,
      soundAuthor: sound.author,
      shop: row.product.productShops[0]?.shop ?? null,
    };

    const periodBucket = latestByPeriod.get(periodIndex);
    if (periodBucket) {
      const existing = periodBucket.get(entry.productId);
      if (!existing || entry.bucketDate >= existing.bucketDate) periodBucket.set(entry.productId, entry);
    }

    if (bucketDate >= currentStart) {
      let dayBucket = dailyByDay.get(entry.dayKey);
      if (!dayBucket) {
        dayBucket = new Map<number, SnapshotEntry>();
        dailyByDay.set(entry.dayKey, dayBucket);
      }
      const existingDay = dayBucket.get(entry.productId);
      if (!existingDay || entry.bucketDate >= existingDay.bucketDate) dayBucket.set(entry.productId, entry);
    }
  }

  return {
    days,
    periodCount,
    anchor,
    periods,
    latestByPeriod,
    dailyByDay,
    daysList: Array.from({ length: days }, (_item, index) => addDays(currentStart, index)),
  };
}

async function loadContext(
  days: number,
  periodCount: number,
  anchorMode: 'latest' | 'today' | 'yesterday' = 'latest',
): Promise<TrendContext> {
  const key = `${days}:${periodCount}:${anchorMode}`;
  const now = Date.now();
  const cached = contextCache.get(key);

  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = buildContext(days, periodCount, anchorMode);
  contextCache.set(key, { expiresAt: now + CONTEXT_TTL_MS, promise });
  promise.catch(() => contextCache.delete(key));

  return promise;
}

/* ------------------------------------------------------------------ */
/* Tính chỉ số & so sánh                                               */
/* ------------------------------------------------------------------ */

function toMetric(current: number, previous: number, precision = 0): TrendMetric {
  const diff = current - previous;
  const change = percentChange(current, previous);
  const direction: TrendDirection =
    Math.abs(change) < FLAT_THRESHOLD_PERCENT ? 'flat' : change > 0 ? 'up' : 'down';

  return {
    current: roundTo(current, precision),
    previous: roundTo(previous, precision),
    diff: roundTo(diff, precision),
    changePercent: change,
    direction,
  };
}

interface AggregatedTotals {
  sales: number;
  gmv: number;
  views: number;
  likes: number;
  shares: number;
  comments: number;
  priceSum: number;
  priceCount: number;
  products: number;
  shops: number;
  videos: number;
}

function aggregate(entries: Iterable<SnapshotEntry>): AggregatedTotals {
  const totals: AggregatedTotals = {
    sales: 0,
    gmv: 0,
    views: 0,
    likes: 0,
    shares: 0,
    comments: 0,
    priceSum: 0,
    priceCount: 0,
    products: 0,
    shops: 0,
    videos: 0,
  };
  const shops = new Set<number>();

  for (const entry of entries) {
    totals.sales += entry.sales;
    totals.gmv += entry.gmv;
    totals.views += entry.views;
    totals.likes += entry.likes;
    totals.shares += entry.shares;
    totals.comments += entry.comments;
    totals.products += 1;
    if (entry.price > 0) {
      totals.priceSum += entry.price;
      totals.priceCount += 1;
    }
    if (entry.shop) shops.add(entry.shop.id);
    if (entry.views > 0) totals.videos += 1;
  }

  totals.shops = shops.size;
  return totals;
}

function avgPrice(totals: AggregatedTotals): number {
  return totals.priceCount > 0 ? safeDivide(totals.priceSum, totals.priceCount) : 0;
}

function buildMetrics(current: AggregatedTotals, previous: AggregatedTotals): CategoryTrendMetrics {
  return {
    sales: toMetric(current.sales, previous.sales),
    gmv: toMetric(current.gmv, previous.gmv),
    views: toMetric(current.views, previous.views),
    likes: toMetric(current.likes, previous.likes),
    shares: toMetric(current.shares, previous.shares),
    comments: toMetric(current.comments, previous.comments),
    avgPrice: toMetric(avgPrice(current), avgPrice(previous)),
    products: toMetric(current.products, previous.products),
    shops: toMetric(current.shops, previous.shops),
    videos: toMetric(current.videos, previous.videos),
  };
}

function buildTotals(current: AggregatedTotals, previous: AggregatedTotals): TrendTotals {
  return {
    sales: toMetric(current.sales, previous.sales),
    gmv: toMetric(current.gmv, previous.gmv),
    views: toMetric(current.views, previous.views),
    products: toMetric(current.products, previous.products),
    shops: toMetric(current.shops, previous.shops),
  };
}

function share(part: number, total: number): number {
  return total > 0 ? roundTo((part / total) * 100, 2) : 0;
}

function groupBy<T>(items: Iterable<T>, selector: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = selector(item);
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

function emptyMetrics(): CategoryTrendMetrics {
  const zero = toMetric(0, 0);
  return {
    sales: { ...zero },
    gmv: { ...zero },
    views: { ...zero },
    likes: { ...zero },
    shares: { ...zero },
    comments: { ...zero },
    avgPrice: { ...zero },
    products: { ...zero },
    shops: { ...zero },
    videos: { ...zero },
  };
}

/* ------------------------------------------------------------------ */
/* Hashtag & Sound                                                     */
/* ------------------------------------------------------------------ */

function buildHashtags(current: SnapshotEntry[], previous: SnapshotEntry[]): TrendHashtagItem[] {
  const currentMap = new Map<string, { count: number; views: number }>();
  const previousMap = new Map<string, { count: number; views: number }>();

  for (const entry of current) {
    for (const tag of entry.hashtags) {
      const record = currentMap.get(tag) ?? { count: 0, views: 0 };
      record.count += 1;
      record.views += entry.views;
      currentMap.set(tag, record);
    }
  }

  for (const entry of previous) {
    for (const tag of entry.hashtags) {
      const record = previousMap.get(tag) ?? { count: 0, views: 0 };
      record.count += 1;
      record.views += entry.views;
      previousMap.set(tag, record);
    }
  }

  return Array.from(currentMap.entries())
    .map<TrendHashtagItem>(([hashtag, value]) => {
      const before = previousMap.get(hashtag);
      const trend = toMetric(value.views, before?.views ?? 0);
      return {
        hashtag,
        count: value.count,
        views: value.views,
        trend: {
          ...trend,
          changePercent: before && before.views > 0 ? trend.changePercent : value.views > 0 ? 100 : 0,
          direction: before && before.views > 0 ? trend.direction : value.views > 0 ? 'up' : 'flat',
        },
      };
    })
    .sort((a, b) => b.views - a.views || b.count - a.count)
    .slice(0, 20);
}

function buildSounds(current: SnapshotEntry[], previous: SnapshotEntry[]): TrendSoundItem[] {
  const key = (entry: SnapshotEntry): string => entry.soundName ?? '';
  const currentMap = new Map<string, { author: string | null; count: number; views: number }>();
  const previousViews = new Map<string, number>();

  for (const entry of current) {
    const name = key(entry);
    if (!name) continue;
    const record = currentMap.get(name) ?? { author: entry.soundAuthor, count: 0, views: 0 };
    record.count += 1;
    record.views += entry.views;
    if (!record.author && entry.soundAuthor) record.author = entry.soundAuthor;
    currentMap.set(name, record);
  }

  for (const entry of previous) {
    const name = key(entry);
    if (!name) continue;
    previousViews.set(name, (previousViews.get(name) ?? 0) + entry.views);
  }

  return Array.from(currentMap.entries())
    .map<TrendSoundItem>(([name, value]) => {
      const before = previousViews.get(name) ?? 0;
      const trend = toMetric(value.views, before);
      return {
        name,
        author: value.author,
        count: value.count,
        views: value.views,
        trend: {
          ...trend,
          changePercent: before > 0 ? trend.changePercent : value.views > 0 ? 100 : 0,
          direction: before > 0 ? trend.direction : value.views > 0 ? 'up' : 'flat',
        },
      };
    })
    .sort((a, b) => b.views - a.views || b.count - a.count)
    .slice(0, 20);
}

/* ------------------------------------------------------------------ */
/* Timeline                                                            */
/* ------------------------------------------------------------------ */

function buildTimeline(context: TrendContext, predicate: (entry: SnapshotEntry) => boolean): TrendTimelinePoint[] {
  return context.daysList.map((day) => {
    const dayKey = isoDateKey(day);
    const bucket = context.dailyByDay.get(dayKey);

    let sales = 0;
    let gmv = 0;
    let views = 0;

    if (bucket) {
      for (const entry of bucket.values()) {
        if (!predicate(entry)) continue;
        sales += entry.sales;
        gmv += entry.gmv;
        views += entry.views;
      }
    }

    return { date: dayKey, sales, gmv: roundTo(gmv, 0), views };
  });
}

/* ------------------------------------------------------------------ */
/* API công khai                                                       */
/* ------------------------------------------------------------------ */

/** GET /api/trend-analysis/overview */
export async function getCategoryTrendOverview(
  rawDays: unknown,
  rawPeriods: unknown,
  rawRange?: unknown,
): Promise<CategoryTrendOverview> {
  const days = resolveDays(rawDays);
  const periodCount = resolvePeriodCount(rawPeriods);
  const context = await loadContext(days, periodCount, resolveAnchorMode(rawDays, rawRange));

  const currentEntries = Array.from(context.latestByPeriod.get(0)?.values() ?? []);
  const previousEntries = Array.from(context.latestByPeriod.get(1)?.values() ?? []);

  const totalCurrent = aggregate(currentEntries);
  const totalPrevious = aggregate(previousEntries);
  const totalGmv = totalCurrent.gmv;

  const currentGroups = groupBy(currentEntries, (entry) => entry.category);
  const previousGroups = groupBy(previousEntries, (entry) => entry.category);

  const categories: CategoryTrendSummary[] = [];

  for (const [category, entries] of currentGroups) {
    const before = previousGroups.get(category) ?? [];
    const current = aggregate(entries);
    const previous = aggregate(before);

    const subGroups = groupBy(entries, (entry) => entry.subCategory);
    const topSubCategory = Array.from(subGroups.entries())
      .map(([name, subEntries]) => ({
        name,
        gmv: subEntries.reduce((sum, entry) => sum + entry.gmv, 0),
      }))
      .sort((a, b) => b.gmv - a.gmv)[0];

    categories.push({
      category,
      shareOfGmv: share(current.gmv, totalGmv),
      topSubCategory: topSubCategory?.name ?? null,
      metrics: buildMetrics(current, previous),
    });
  }

  categories.sort((a, b) => b.metrics.gmv.current - a.metrics.gmv.current);

  return {
    periods: context.periods,
    totals: buildTotals(totalCurrent, totalPrevious),
    categories,
  };
}

/** GET /api/trend-analysis/category/:category */
export async function getCategoryTrendDetail(
  categoryName: string,
  rawDays: unknown,
  rawPeriods: unknown,
  rawRange?: unknown,
): Promise<CategoryTrendDetail> {
  const days = resolveDays(rawDays);
  const periodCount = resolvePeriodCount(rawPeriods);
  const context = await loadContext(days, periodCount, resolveAnchorMode(rawDays, rawRange));

  const category = categoryName.trim();
  if (!category) throw AppError.badRequest('Tên ngành hàng không được để trống');

  const currentEntries = Array.from(context.latestByPeriod.get(0)?.values() ?? []).filter(
    (entry) => entry.category === category,
  );
  if (currentEntries.length === 0) {
    throw AppError.notFound(`Không tìm thấy dữ liệu xu hướng cho ngành hàng "${category}"`);
  }

  const previousEntries = Array.from(context.latestByPeriod.get(1)?.values() ?? []).filter(
    (entry) => entry.category === category,
  );

  const currentTotals = aggregate(currentEntries);
  const previousTotals = aggregate(previousEntries);

  const allCurrent = Array.from(context.latestByPeriod.get(0)?.values() ?? []);
  const totalGmv = allCurrent.reduce((sum, entry) => sum + entry.gmv, 0);

  const currentGroups = groupBy(currentEntries, (entry) => entry.subCategory);
  const previousGroups = groupBy(previousEntries, (entry) => entry.subCategory);

  const subCategories = Array.from(currentGroups.entries())
    .map(([name, entries]) => {
      const current = aggregate(entries);
      const previous = aggregate(previousGroups.get(name) ?? []);
      return {
        name,
        shareOfGmv: share(current.gmv, currentTotals.gmv),
        metrics: buildMetrics(current, previous),
      };
    })
    .sort((a, b) => b.metrics.gmv.current - a.metrics.gmv.current);

  const previousById = new Map(previousEntries.map((entry) => [entry.productId, entry]));

  const topProducts = [...currentEntries]
    .sort((a, b) => b.gmv - a.gmv)
    .slice(0, 10)
    .map<TrendTopProduct>((entry) => {
      const before = previousById.get(entry.productId);
      return {
        id: entry.productId,
        title: entry.title,
        imageUrl: entry.imageUrl,
        productUrl: entry.productUrl,
        shopName: entry.shop?.name ?? 'TikTok Shop',
        price: entry.price,
        sales: entry.sales,
        gmv: entry.gmv,
        views: entry.views,
        salesTrend: toMetric(entry.sales, before?.sales ?? 0),
        gmvTrend: toMetric(entry.gmv, before?.gmv ?? 0),
      };
    });

  const topVideos = [...currentEntries]
    .filter((entry) => entry.views > 0)
    .sort((a, b) => b.views - a.views)
    .slice(0, 12)
    .map<TrendVideoItem>((entry) => {
      const before = previousById.get(entry.productId);
      return {
        productId: entry.productId,
        title: entry.title,
        imageUrl: entry.imageUrl,
        videoUrl: entry.productUrl,
        shopName: entry.shop?.name ?? 'TikTok Shop',
        category: entry.category,
        subCategory: entry.subCategory,
        bucketDate: isoDateKey(entry.bucketDate),
        price: entry.price,
        sales: entry.sales,
        gmv: entry.gmv,
        playCount: entry.views,
        diggCount: entry.likes,
        shareCount: entry.shares,
        commentCount: entry.comments,
        viewTrend: toMetric(entry.views, before?.views ?? 0),
      };
    });

  return {
    category,
    periods: context.periods,
    metrics: buildMetrics(currentTotals, previousTotals),
    shareOfGmv: share(currentTotals.gmv, totalGmv),
    timeline: buildTimeline(context, (entry) => entry.category === category),
    subCategories,
    topProducts,
    topVideos,
    hashtags: buildHashtags(currentEntries, previousEntries),
    sounds: buildSounds(currentEntries, previousEntries),
  };
}

/** GET /api/trend-analysis/comparison */
export async function getTrendComparison(
  rawDays: unknown,
  rawPeriods: unknown,
  rawCategories: unknown,
  rawRange?: unknown,
): Promise<TrendComparison> {
  const days = resolveDays(rawDays);
  const periodCount = resolvePeriodCount(rawPeriods);
  const context = await loadContext(days, periodCount, resolveAnchorMode(rawDays, rawRange));

  const currentEntries = Array.from(context.latestByPeriod.get(0)?.values() ?? []);
  const previousEntries = Array.from(context.latestByPeriod.get(1)?.values() ?? []);

  const requested = Array.isArray(rawCategories)
    ? rawCategories
    : typeof rawCategories === 'string'
      ? rawCategories.split(',')
      : [];

  const filter = new Set(
    requested
      .map((value) => String(value).trim().toLowerCase())
      .filter((value) => value.length > 0),
  );

  const currentGroups = groupBy(currentEntries, (entry) => entry.category);
  const previousGroups = groupBy(previousEntries, (entry) => entry.category);
  const totalGmv = currentEntries.reduce((sum, entry) => sum + entry.gmv, 0);

  const rows: TrendComparisonRow[] = [];

  for (const [category, entries] of currentGroups) {
    if (filter.size > 0 && !filter.has(category.toLowerCase())) continue;

    const current = aggregate(entries);
    const previous = aggregate(previousGroups.get(category) ?? []);

    rows.push({
      category,
      shareOfGmv: share(current.gmv, totalGmv),
      metrics: buildMetrics(current, previous),
    });
  }

  for (const [category, entries] of previousGroups) {
    if (currentGroups.has(category)) continue;
    if (filter.size > 0 && !filter.has(category.toLowerCase())) continue;

    const previous = aggregate(entries);
    rows.push({
      category,
      shareOfGmv: 0,
      metrics: {
        ...emptyMetrics(),
        sales: toMetric(0, previous.sales),
        gmv: toMetric(0, previous.gmv),
        views: toMetric(0, previous.views),
        products: toMetric(0, previous.products),
        shops: toMetric(0, previous.shops),
        videos: toMetric(0, previous.videos),
      },
    });
  }

  rows.sort((a, b) => b.metrics.gmv.current - a.metrics.gmv.current);

  return {
    periods: context.periods,
    totals: buildTotals(aggregate(currentEntries), aggregate(previousEntries)),
    rows,
  };
}

/** GET /api/trend-analysis/periods — danh sách kỳ để dựng bộ lọc UI. */
export async function getTrendPeriods(
  rawDays: unknown,
  rawPeriods: unknown,
  rawRange?: unknown,
): Promise<{ anchor: string; days: number; periods: TrendPeriod[] }> {
  const days = resolveDays(rawDays);
  const periodCount = resolvePeriodCount(rawPeriods);
  const context = await loadContext(days, periodCount, resolveAnchorMode(rawDays, rawRange));

  return {
    anchor: toIso(context.anchor) ?? '',
    days: context.days,
    periods: context.periods,
  };
}

/** Dùng cho test/backfill: xoá cache ngắn hạn. */
export function clearTrendCache(): void {
  contextCache.clear();
}
