/**
 * Shared Analytics Service (Giai đoạn 2).
 *
 * Single source of truth for period metrics (7/30/90 days), growth, timelines,
 * competition, coverage and confidence — consumed by both AI systems and the
 * chart APIs. Never mixes SIMULATED and REAL data: every series read is scoped
 * to an explicit AnalysisMode.
 *
 * - REAL_DATA  : only VERIFIED/ESTIMATED rows (source != 'simulated').
 * - SIMULATION : only simulated rows (source == 'simulated').
 * Missing data is returned as null (INSUFFICIENT baseline), never fabricated.
 */

import { datasetDb as db } from '../config/datasetDb.js';
import { datasetDay, type DataKind } from './analytics.js';
import { dailyIncrements, type HistoryPoint } from './snapshotService.js';

export type AnalysisMode = 'REAL_DATA' | 'SIMULATION';
export const SIMULATED_SOURCE = 'simulated';
export const GROWTH_WINDOWS = [1, 7, 30, 90] as const;

export function parseMode(raw: unknown): AnalysisMode {
  return String(raw ?? '').trim().toLowerCase() === 'simulation' ? 'SIMULATION' : 'REAL_DATA';
}

export interface SeriesPoint {
  date: string;
  value: number | null;
  source: string;
  isEstimated: boolean;
  dataKind: DataKind;
}

export function dataKindFor(source: string, isEstimated: boolean): DataKind {
  if (source.startsWith(SIMULATED_SOURCE)) return 'SIMULATED';
  return isEstimated ? 'ESTIMATED' : 'VERIFIED';
}

export interface DatasetMetric {
  current: number | null;
  previous: number | null;
  diff: number | null;
  changePercent: number | null;
  delta: number | null;
  growthRate: number | null;
  direction: 'up' | 'down' | 'flat' | 'unknown';
  hasData: boolean;
  hasBaseline: boolean;
}

export interface GrowthPeriod {
  days: number;
  gmv: DatasetMetric;
  sales: DatasetMetric;
  orders: DatasetMetric;
  salesDiff: number | null;
  gmvDelta: number | null;
  salesGrowthRate: number | null;
  gmvGrowthRate: number | null;
  direction: 'up' | 'down' | 'flat' | 'unknown';
  hasData: boolean;
}

export interface GrowthSummary {
  primary: GrowthPeriod;
  periods: GrowthPeriod[];
  metrics: GrowthPeriod[];
}

export const unavailableMetric = (): DatasetMetric => ({
  current: null, previous: null, diff: null, changePercent: null, delta: null,
  growthRate: null, direction: 'unknown', hasData: false, hasBaseline: false,
});

function metric(current: number | null, previous: number | null): DatasetMetric {
  const hasBaseline = previous !== null && previous > 0;
  const delta = current !== null && previous !== null ? round(current - previous) : null;
  const growthRate = current !== null && previous !== null && hasBaseline ? round((current - previous) / previous * 100) : null;
  const direction: DatasetMetric['direction'] = growthRate === null ? 'unknown' : growthRate > 0.5 ? 'up' : growthRate < -0.5 ? 'down' : 'flat';
  return { current, previous, diff: delta, changePercent: growthRate, delta, growthRate, direction, hasData: current !== null, hasBaseline };
}

function round(value: number): number { return Math.round(value * 100) / 100; }

function addDaysStr(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Read a metric series scoped to a mode. Multiple sources within a mode collapse to one point/day (latest wins). */
export async function readSeries(entityType: string, entityId: number, metric: string, mode: AnalysisMode = 'REAL_DATA'): Promise<SeriesPoint[]> {
  const rows = await db.metricSnapshot.findMany({
    where: {
      entityType, entityId, metric,
      source: mode === 'SIMULATION' ? { startsWith: SIMULATED_SOURCE } : { not: { startsWith: SIMULATED_SOURCE } },
    },
    orderBy: [{ bucketDate: 'asc' }, { source: 'asc' }],
    select: { bucketDate: true, value: true, source: true, isEstimated: true },
  });
  const byDay = new Map<string, SeriesPoint>();
  for (const row of rows) {
    const date = datasetDay(row.bucketDate);
    byDay.set(date, {
      date,
      value: row.value === null ? null : Number(row.value),
      source: row.source,
      isEstimated: row.isEstimated,
      dataKind: dataKindFor(row.source, row.isEstimated),
    });
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Cumulative → daily increments (drop null/reset points). */
function increments(series: SeriesPoint[]): HistoryPoint[] {
  return dailyIncrements(series.map((p) => ({ date: p.date, value: p.value })));
}

function windowSum(inc: HistoryPoint[], start: string, end: string): number | null {
  const inWindow = inc.filter((p) => p.value !== null && p.date >= start && p.date <= end);
  if (inWindow.length === 0) return null;
  return inWindow.reduce((sum, p) => sum + (p.value as number), 0);
}

function lastDate(seriesList: SeriesPoint[][]): string | null {
  const dates = seriesList.flatMap((s) => s.map((p) => p.date));
  return dates.sort().at(-1) ?? null;
}

/**
 * Build 1/7/30/90-day growth for a cumulative metric pair (sales + gmv).
 * Growth = (increment in current N-day window) vs (increment in previous N-day window).
 */
export function buildGrowthSummary(
  salesSeries: SeriesPoint[],
  gmvSeries: SeriesPoint[],
  selectedDays: number = 30,
): GrowthSummary {
  const anchor = lastDate([salesSeries, gmvSeries]);
  if (anchor === null) return emptyGrowth(selectedDays);

  const salesInc = increments(salesSeries);
  const gmvInc = increments(gmvSeries);

  const periods = GROWTH_WINDOWS.map((days) => {
    const curStart = addDaysStr(anchor, -(days - 1));
    const prevEnd = addDaysStr(curStart, -1);
    const prevStart = addDaysStr(prevEnd, -(days - 1));

    const curSales = windowSum(salesInc, curStart, anchor);
    const prevSales = windowSum(salesInc, prevStart, prevEnd);
    const curGmv = windowSum(gmvInc, curStart, anchor);
    const prevGmv = windowSum(gmvInc, prevStart, prevEnd);

    const sales = metric(curSales, prevSales);
    const gmv = metric(curGmv, prevGmv);
    const hasData = sales.hasData || gmv.hasData;
    const direction: GrowthPeriod['direction'] = sales.direction !== 'unknown' ? sales.direction : gmv.direction;

    return {
      days,
      gmv,
      sales,
      orders: unavailableMetric(),
      salesDiff: sales.diff,
      gmvDelta: gmv.diff,
      salesGrowthRate: sales.growthRate,
      gmvGrowthRate: gmv.growthRate,
      direction,
      hasData,
    };
  });

  const primary = periods.find((p) => p.days === selectedDays) ?? periods[2] ?? periods[0]!;
  return { primary, periods, metrics: periods };
}

export function emptyGrowth(days: number = 30): GrowthSummary {
  const periods = GROWTH_WINDOWS.map((d) => ({
    days: d,
    gmv: unavailableMetric(),
    sales: unavailableMetric(),
    orders: unavailableMetric(),
    salesDiff: null,
    gmvDelta: null,
    salesGrowthRate: null,
    gmvGrowthRate: null,
    direction: 'unknown' as const,
    hasData: false,
  }));
  const primary = periods.find((p) => p.days === days) ?? periods[2]!;
  return { primary, periods, metrics: periods };
}

/** Dated timeline aligned by day across sales/gmv/price, with a dataKind per point. */
export function buildTimeline(
  salesSeries: SeriesPoint[],
  gmvSeries: SeriesPoint[],
  priceSeries: SeriesPoint[],
): { points: Array<{ date: string; sales: number | null; gmv: number | null; price: number | null; dataKind: DataKind }>; dataKind: DataKind; mode: AnalysisMode } {
  const byDate = new Map<string, { date: string; sales: number | null; gmv: number | null; price: number | null; dataKind: DataKind }>();
  const kinds = new Set<DataKind>();
  const put = (s: SeriesPoint, key: 'sales' | 'gmv' | 'price') => {
    const entry = byDate.get(s.date) ?? { date: s.date, sales: null, gmv: null, price: null, dataKind: s.dataKind };
    entry[key] = s.value;
    entry.dataKind = s.dataKind;
    kinds.add(s.dataKind);
    byDate.set(s.date, entry);
  };
  for (const p of salesSeries) put(p, 'sales');
  for (const p of gmvSeries) put(p, 'gmv');
  for (const p of priceSeries) put(p, 'price');

  const points = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const dataKind: DataKind = kinds.size === 1 ? (kinds.values().next().value as DataKind) : kinds.has('SIMULATED') ? 'SIMULATED' : 'ESTIMATED';
  const mode: AnalysisMode = dataKind === 'SIMULATED' ? 'SIMULATION' : 'REAL_DATA';
  return { points, dataKind, mode };
}

export interface Coverage {
  points: number;
  start: string | null;
  end: string | null;
  spanDays: number;
  expectedDays: number;
  completeness: number | null;
  gaps: string[];
}

/** Data coverage for a series over an expected window (anchor = last dated point). */
export function coverage(series: SeriesPoint[], expectedDays: number = 90): Coverage {
  const dated = series.filter((p) => p.value !== null);
  const start = dated[0]?.date ?? null;
  const end = dated.at(-1)?.date ?? null;
  const spanDays = start && end ? Math.floor((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1 : 0;
  const gaps: string[] = [];
  if (start && end) {
    for (let d = addDaysStr(start, 1); d < end; d = addDaysStr(d, 1)) {
      if (!dated.some((p) => p.date === d)) gaps.push(d);
    }
  }
  return {
    points: dated.length,
    start,
    end,
    spanDays,
    expectedDays,
    completeness: expectedDays > 0 ? Math.min(1, dated.length / expectedDays) : null,
    gaps,
  };
}

export interface Competition {
  sellerCount: number;
  topShopShare: number | null;
  concentration: number | null;
  mode: AnalysisMode;
  notes: string[];
}

/**
 * Competition for a product. REAL_DATA returns only the number of verified active
 * selling shops (share/concentration stay null — no per-shop sales attribution exists).
 * SIMULATION returns the simulated topShopShare and concentration (HHI) series tail.
 */
export async function competition(productId: number, mode: AnalysisMode = 'REAL_DATA'): Promise<Competition> {
  const links = await db.productShop.findMany({
    where: mode === 'SIMULATION'
      ? { productId, isSimulated: true, isActive: true }
      : { productId, verificationStatus: 'VERIFIED', isActive: true, isSimulated: false },
    select: { shopId: true },
  });
  const sellerCount = links.length;

  if (mode === 'SIMULATION') {
    const topRows = await readSeries('PRODUCT', productId, 'topShopShare', 'SIMULATION');
    const hhiRows = await readSeries('PRODUCT', productId, 'concentrationHhi', 'SIMULATION');
    const countRows = await readSeries('PRODUCT', productId, 'sellerCount', 'SIMULATION');
    const top = topRows.at(-1)?.value ?? null;
    const hhi = hhiRows.at(-1)?.value ?? null;
    const simSellerCount = countRows.at(-1)?.value ?? null;
    return {
      sellerCount: simSellerCount !== null ? Math.round(simSellerCount) : sellerCount,
      topShopShare: top !== null ? round4(top) : null,
      concentration: hhi !== null ? round4(hhi) : null,
      mode,
      notes: ['SIMULATION: thị phần shop và mức độ tập trung là mô phỏng, không phải doanh thu EchoTik thực.'],
    };
  }

  return {
    sellerCount,
    topShopShare: null,
    concentration: null,
    mode,
    notes: links.length === 0 ? ['Không có shop bán đã xác minh cho sản phẩm này.'] : ['REAL_DATA: chưa có phân bố doanh số theo shop thực; thị phần/tập trung giữ null.'],
  };
}

function round4(value: number): number { return Math.round(value * 10000) / 10000; }

export async function affiliateContribution(productId: number, mode: AnalysisMode = 'REAL_DATA') {
  if (mode === 'REAL_DATA') {
    const count = await db.productCreator.count({ where: { productId, verificationStatus: 'VERIFIED', isSimulated: false } });
    return { mode, creatorCount: count, sold: null as number | null, gmv: null as number | null, share: null as number | null, dataKind: 'UNKNOWN' as DataKind, limitation: count ? 'No verified affiliate sales observations are stored.' : 'No verified ProductCreator relations.' };
  }
  const [sales, gmv, share, creators] = await Promise.all([
    readSeries('PRODUCT', productId, 'affiliateSold', 'SIMULATION'),
    readSeries('PRODUCT', productId, 'affiliateGmv', 'SIMULATION'),
    readSeries('PRODUCT', productId, 'affiliateShare', 'SIMULATION'),
    db.productCreator.count({ where: { productId, isSimulated: true } }),
  ]);
  return { mode, creatorCount: creators, sold: sales.at(-1)?.value ?? null, gmv: gmv.at(-1)?.value ?? null, share: share.at(-1)?.value ?? null, dataKind: 'SIMULATED' as DataKind, limitation: 'Simulated affiliate contribution is allocated only across synthetic ProductCreator links.' };
}

export async function shopPerformance(shopId: number, mode: AnalysisMode = 'REAL_DATA') {
  const shop = await db.shop.findUnique({ where: { id: shopId }, select: { id: true, name: true, isSimulated: true } });
  if (!shop || (mode === 'REAL_DATA' && shop.isSimulated) || (mode === 'SIMULATION' && !shop.isSimulated)) return null;
  if (mode === 'REAL_DATA') return { id: shop.id, name: shop.name, mode, sales: null, gmv: null, dataKind: 'UNKNOWN' as DataKind, limitation: 'No verified dated shop-attributed sales are stored.' };
  const [sales, gmv, affiliateSales, affiliateGmv] = await Promise.all([
    readSeries('SHOP', shopId, 'productSoldCount', mode),
    readSeries('SHOP', shopId, 'productGmv', mode),
    readSeries('SHOP', shopId, 'affiliateSold', mode),
    readSeries('SHOP', shopId, 'affiliateGmv', mode),
  ]);
  return { id: shop.id, name: shop.name, mode, sales: sales.at(-1)?.value ?? null, gmv: gmv.at(-1)?.value ?? null, affiliateSales: affiliateSales.at(-1)?.value ?? null, affiliateGmv: affiliateGmv.at(-1)?.value ?? null, dataKind: 'SIMULATED' as DataKind };
}

export async function creatorPerformance(creatorId: number, mode: AnalysisMode = 'REAL_DATA') {
  const creator = await db.creator.findUnique({ where: { id: creatorId }, select: { id: true, displayName: true, isSimulated: true } });
  if (!creator || (mode === 'REAL_DATA' && creator.isSimulated) || (mode === 'SIMULATION' && !creator.isSimulated)) return null;
  if (mode === 'REAL_DATA') return { id: creator.id, displayName: creator.displayName, mode, sales: null, gmv: null, activity: null, dataKind: 'UNKNOWN' as DataKind, limitation: 'No verified creator-attributed sales are stored.' };
  const [sales, gmv, activity] = await Promise.all([
    readSeries('CREATOR', creatorId, 'soldCount', mode),
    readSeries('CREATOR', creatorId, 'gmv', mode),
    readSeries('CREATOR', creatorId, 'activityCount', mode),
  ]);
  return { id: creator.id, displayName: creator.displayName, mode, sales: sales.at(-1)?.value ?? null, gmv: gmv.at(-1)?.value ?? null, activity: activity.at(-1)?.value ?? null, dataKind: 'SIMULATED' as DataKind };
}

/**
 * Market-level growth: sums daily increments across all products for a mode.
 * Uses per-product cumulative→increment first, then sums, so cumulative totals
 * are never double-counted across days.
 */
export async function marketGrowth(mode: AnalysisMode = 'REAL_DATA', selectedDays = 30): Promise<GrowthSummary> {
  const sourceWhere = mode === 'SIMULATION' ? { startsWith: SIMULATED_SOURCE } : { not: { startsWith: SIMULATED_SOURCE } };
  const rows = await db.metricSnapshot.findMany({
    where: { entityType: 'PRODUCT', metric: { in: ['soldCount', 'gmv'] }, source: sourceWhere },
    orderBy: [{ entityId: 'asc' }, { bucketDate: 'asc' }],
    select: { entityId: true, metric: true, bucketDate: true, value: true },
  });

  const byEntity = new Map<number, { sales: HistoryPoint[]; gmv: HistoryPoint[] }>();
  for (const row of rows) {
    const date = datasetDay(row.bucketDate);
    const value = row.value === null ? null : Number(row.value);
    const entry = byEntity.get(row.entityId) ?? { sales: [], gmv: [] };
    (row.metric === 'soldCount' ? entry.sales : entry.gmv).push({ date, value });
    byEntity.set(row.entityId, entry);
  }

  const salesByDay = new Map<string, number>();
  const gmvByDay = new Map<string, number>();
  for (const { sales, gmv } of byEntity.values()) {
    for (const inc of dailyIncrements(sales.sort((a, b) => a.date.localeCompare(b.date)))) {
      if (inc.value !== null) salesByDay.set(inc.date, (salesByDay.get(inc.date) ?? 0) + inc.value);
    }
    for (const inc of dailyIncrements(gmv.sort((a, b) => a.date.localeCompare(b.date)))) {
      if (inc.value !== null) gmvByDay.set(inc.date, (gmvByDay.get(inc.date) ?? 0) + inc.value);
    }
  }

  const salesSeries: SeriesPoint[] = [...salesByDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value, source: mode === 'SIMULATION' ? SIMULATED_SOURCE : 'dataset-v2', isEstimated: true, dataKind: mode === 'SIMULATION' ? 'SIMULATED' : 'ESTIMATED' }));
  const gmvSeries: SeriesPoint[] = [...gmvByDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value, source: mode === 'SIMULATION' ? SIMULATED_SOURCE : 'dataset-v2', isEstimated: true, dataKind: mode === 'SIMULATION' ? 'SIMULATED' : 'ESTIMATED' }));

  return buildGrowthSummary(salesSeries, gmvSeries, selectedDays);
}
