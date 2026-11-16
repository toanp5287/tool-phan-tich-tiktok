import { addDays, daysAgo, startOfUtcDay, type RangeAnchor } from '../../utils/dates.js';
import { percentChange, roundTo } from '../../utils/numbers.js';
import type { GrowthDirection, MultiPeriodMetrics, PeriodMetric, PeriodMetrics, RangeMeta } from './shopCommerceTypes.js';

export const COMMERCE_PERIODS = [1, 7, 30, 90] as const;
export type CommercePeriod = (typeof COMMERCE_PERIODS)[number];

const RANGE_LABELS: Record<number, string> = {
  1: 'Hôm qua',
  7: '7 ngày qua',
  30: '30 ngày qua',
  90: '90 ngày qua',
};

/**
 * Chuẩn hoá bộ lọc thời gian toàn cục:
 * `today | yesterday | 7d | 30d | 90d | days=N`.
 * - `today`     : hôm nay (bao gồm hôm nay) – kỳ hiện tại 1 ngày.
 * - `yesterday` : hôm qua – kỳ hiện tại 1 ngày (không gồm hôm nay).
 * - `7d/30d/90d`: cửa sổ trượt N ngày tính đến hôm nay.
 */
export function resolveCommerceRange(query: { range?: unknown; days?: unknown; yesterday?: unknown }): RangeMeta {
  const rawRange = typeof query.range === 'string' ? query.range.trim().toLowerCase() : '';
  const rawYesterday = query.yesterday;

  if (rawYesterday === 'true' || rawYesterday === '1') {
    return buildRange(1, 'yesterday', 'yesterday');
  }

  if (rawRange === 'today' || rawRange === 'hom-nay' || rawRange === 'current' || rawRange === 'now') {
    return buildRange(1, 'today', 'today');
  }

  if (rawRange === 'yesterday' || rawRange === 'hom-qua' || rawRange === '1d') {
    return buildRange(1, 'yesterday', 'yesterday');
  }

  const alias: Record<string, CommercePeriod> = {
    '7': 7,
    '7d': 7,
    '7days': 7,
    'last-7-days': 7,
    '30': 30,
    '30d': 30,
    '30days': 30,
    'last-30-days': 30,
    '90': 90,
    '90d': 90,
    '90days': 90,
    'last-90-days': 90,
  };

  const mapped = alias[rawRange];
  if (mapped) return buildRange(mapped, `${mapped}d`, 'today');

  const rawDays = typeof query.days === 'number' || typeof query.days === 'string' ? Number(query.days) : Number.NaN;
  if (Number.isFinite(rawDays) && rawDays > 0) {
    const period = clampPeriod(rawDays);
    return buildRange(period, period === 1 ? 'today' : `${period}d`, period === 1 ? 'today' : 'today');
  }

  return buildRange(30, '30d', 'today');
}

/** Làm tròn về mốc gần nhất trong 1/7/30/90 để UI luôn có dữ liệu so sánh. */
export function clampPeriod(value: number): CommercePeriod {
  let best: CommercePeriod = 30;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const period of COMMERCE_PERIODS) {
    const distance = Math.abs(period - value);
    if (distance < bestDistance) {
      best = period;
      bestDistance = distance;
    }
  }
  return best;
}

function buildRange(days: CommercePeriod, key: string, anchor: RangeAnchor): RangeMeta {
  return {
    key,
    label:
      anchor === 'yesterday' && days === 1
        ? 'Hôm qua'
        : anchor === 'today' && days === 1
          ? 'Hôm nay'
          : (RANGE_LABELS[days] ?? `${days} ngày qua`),
    days,
    anchor,
  };
}

/** Chấp nhận cả số ngày (API cũ) lẫn RangeMeta để giữ tương thích. */
export function toRangeMeta(value: number | RangeMeta, anchor: RangeAnchor = 'today'): RangeMeta {
  if (typeof value === 'number') {
    return {
      key: value === 1 ? (anchor === 'yesterday' ? 'yesterday' : 'today') : `${value}d`,
      label:
        value === 1
          ? anchor === 'yesterday'
            ? 'Hôm qua'
            : 'Hôm nay'
          : (RANGE_LABELS[value] ?? `${value} ngày qua`),
      days: value,
      anchor,
    };
  }
  return value;
}

/* ------------------------------------------------------------------ */
/* Cửa sổ thời gian cho so sánh kỳ hiện tại vs kỳ trước                */
/* ------------------------------------------------------------------ */

export interface PeriodWindow {
  days: number;
  /** Ngày cuối của kỳ hiện tại (bucketDate). */
  end: Date;
  /** Ngày cuối của kỳ trước (bucketDate). */
  previousEnd: Date;
  /** Ngày cuối cùng trước khi kỳ hiện tại bắt đầu. */
  base: Date;
  /** Ngày cuối cùng trước khi kỳ trước bắt đầu. */
  previousBase: Date;
}

/**
 * `Hôm nay` / `Hôm qua` (days=1) lấy trọn đúng ngày tương ứng; các mốc khác lấy
 * cửa sổ trượt N ngày tính đến mốc neo (bao gồm ngày neo), giống bộ lọc toàn cục.
 *
 * Mọi phép so sánh đều dựa trên `bucketDate` của snapshot lịch sử.
 */
export function buildPeriodWindow(
  days: CommercePeriod,
  now: Date = new Date(),
  anchor: RangeAnchor = 'today',
): PeriodWindow {
  const todayStart = startOfUtcDay(now);
  const anchorDay = anchor === 'yesterday' ? addDays(todayStart, -1) : todayStart;
  const end = anchorDay;
  const base = addDays(end, -days);
  const previousBase = addDays(base, -days);

  return {
    days,
    end,
    base,
    previousEnd: base,
    previousBase,
  };
}

export function periodWindows(now: Date = new Date(), anchor: RangeAnchor = 'today'): PeriodWindow[] {
  return COMMERCE_PERIODS.map((days) => buildPeriodWindow(days, now, anchor));
}

/**
 * Mốc neo (bucketDate) của cửa sổ đang chọn.
 * - `today`     -> hôm nay.
 * - `yesterday` -> hôm qua.
 */
export function currentAnchor(now: Date = new Date(), anchor: RangeAnchor = 'today'): Date {
  const todayStart = startOfUtcDay(now);
  return anchor === 'yesterday' ? addDays(todayStart, -1) : todayStart;
}

/** Mốc dữ liệu xa nhất cần nạp: 2 x 90 ngày + đệm. */
export function commerceLookbackStart(now: Date = new Date()): Date {
  return daysAgo(2 * 90 + 7, now);
}

/* ------------------------------------------------------------------ */
/* Chuỗi snapshot luỹ kế                                              */
/* ------------------------------------------------------------------ */

export interface CumulativePoint {
  bucketDate: Date;
  sold: number;
  gmv: number;
  price: number;
  playCount: number;
  diggCount: number;
  shareCount: number;
  commentCount: number;
  stockTotal: number | null;
  ratingScore: number | null;
  ratingCount: number | null;
  capturedAt: Date;
}

/** Giá trị luỹ kế mới nhất tại hoặc trước `date`. */
export function valueAt(points: readonly CumulativePoint[], date: Date): CumulativePoint | null {
  let candidate: CumulativePoint | null = null;
  for (const point of points) {
    if (point.bucketDate.getTime() > date.getTime()) break;
    candidate = point;
  }
  return candidate;
}

/** Phát sinh trong N ngày = value(end) - value(end - N). */
export function deltaAt(
  points: readonly CumulativePoint[],
  window: PeriodWindow,
): {
  current: number;
  previous: number;
  hasBaseline: boolean;
  hasPreviousBaseline: boolean;
  gmvCurrent: number;
  gmvPrevious: number;
  hasGmvBaseline: boolean;
} {
  const currentPoint = valueAt(points, window.end);
  const basePoint = valueAt(points, window.base);
  const previousBasePoint = valueAt(points, window.previousBase);

  const current = currentPoint && basePoint ? Math.max(0, currentPoint.sold - basePoint.sold) : 0;
  const previous = basePoint && previousBasePoint ? Math.max(0, basePoint.sold - previousBasePoint.sold) : 0;

  const gmvCurrent = currentPoint && basePoint ? Math.max(0, currentPoint.gmv - basePoint.gmv) : 0;
  const gmvPrevious = basePoint && previousBasePoint ? Math.max(0, basePoint.gmv - previousBasePoint.gmv) : 0;

  return {
    current,
    previous,
    hasBaseline: Boolean(currentPoint && basePoint),
    hasPreviousBaseline: Boolean(basePoint && previousBasePoint),
    gmvCurrent,
    gmvPrevious,
    hasGmvBaseline: Boolean(currentPoint && basePoint),
  };
}

/* ------------------------------------------------------------------ */
/* Tổng hợp nhiều sản phẩm -> PeriodMetrics                            */
/* ------------------------------------------------------------------ */

export interface AggregateAccumulator {
  salesCurrent: number;
  salesPrevious: number;
  gmvCurrent: number;
  gmvPrevious: number;
  salesCurrentComparable: number;
  salesPreviousComparable: number;
  gmvCurrentComparable: number;
  gmvPreviousComparable: number;
  hasBaseline: boolean;
  hasPreviousBaseline: boolean;
}

export function createAccumulator(): AggregateAccumulator {
  return {
    salesCurrent: 0,
    salesPrevious: 0,
    gmvCurrent: 0,
    gmvPrevious: 0,
    salesCurrentComparable: 0,
    salesPreviousComparable: 0,
    gmvCurrentComparable: 0,
    gmvPreviousComparable: 0,
    hasBaseline: false,
    hasPreviousBaseline: false,
  };
}

export function accumulate(acc: AggregateAccumulator, points: readonly CumulativePoint[], window: PeriodWindow): void {
  const delta = deltaAt(points, window);

  acc.salesCurrent += delta.current;
  acc.gmvCurrent += delta.gmvCurrent;
  acc.hasBaseline = acc.hasBaseline || delta.hasBaseline;
  acc.hasPreviousBaseline = acc.hasPreviousBaseline || delta.hasPreviousBaseline;

  if (delta.hasPreviousBaseline) {
    acc.salesPrevious += delta.previous;
    acc.gmvPrevious += delta.gmvPrevious;
    acc.salesCurrentComparable += delta.current;
    acc.salesPreviousComparable += delta.previous;
    acc.gmvCurrentComparable += delta.gmvCurrent;
    acc.gmvPreviousComparable += delta.gmvPrevious;
  }
}

export function toPeriodMetric(current: number, previous: number, hasBaseline: boolean): PeriodMetric {
  const direction = resolveDirection(current, previous);
  return {
    days: 0,
    current: roundTo(current, 0),
    previous: roundTo(previous, 0),
    delta: roundTo(Math.max(0, current - previous), 0),
    growthRate: percentChange(current, previous),
    direction,
    hasBaseline,
  };
}

export function resolveDirection(current: number, previous: number): GrowthDirection {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return 'flat';
  if (previous <= 0) return current > 0 ? 'up' : 'flat';
  const change = percentChange(current, previous);
  if (change > 0.5) return 'up';
  if (change < -0.5) return 'down';
  return 'flat';
}

export function finalizePeriodMetrics(acc: AggregateAccumulator, window: PeriodWindow): PeriodMetrics {
  const useComparable = acc.hasPreviousBaseline;

  const sales = toPeriodMetric(
    useComparable ? acc.salesCurrentComparable : acc.salesCurrent,
    useComparable ? acc.salesPreviousComparable : acc.salesPrevious,
    acc.hasBaseline && useComparable,
  );

  const gmv = toPeriodMetric(
    useComparable ? acc.gmvCurrentComparable : acc.gmvCurrent,
    useComparable ? acc.gmvPreviousComparable : acc.gmvPrevious,
    acc.hasBaseline && useComparable,
  );

  // "Đơn hàng" ước tính từ số bán (1 đơn ≈ 1 sản phẩm) — không bịa thêm nguồn.
  const orders = toPeriodMetric(Math.max(0, sales.current), Math.max(0, sales.previous), sales.hasBaseline);

  return {
    days: window.days,
    gmv: { ...gmv, days: window.days },
    sales: { ...sales, days: window.days },
    orders: { ...orders, days: window.days },
  };
}

export function emptyMultiPeriod(): MultiPeriodMetrics {
  const periods = COMMERCE_PERIODS.map((days) => ({
    days,
    gmv: emptyMetric(days),
    sales: emptyMetric(days),
    orders: emptyMetric(days),
  }));
  return {
    primary: periods[0] ?? { days: 1, gmv: emptyMetric(1), sales: emptyMetric(1), orders: emptyMetric(1) },
    periods,
  };
}

function emptyMetric(days: number): PeriodMetric {
  return { days, current: 0, previous: 0, delta: 0, growthRate: 0, direction: 'flat', hasBaseline: false };
}

export function buildMultiPeriod(
  series: readonly CumulativePoint[],
  windows: readonly PeriodWindow[],
  selectedDays: number,
): MultiPeriodMetrics {
  const periods = windows.map((window) => {
    const acc = createAccumulator();
    accumulate(acc, series, window);
    return finalizePeriodMetrics(acc, window);
  });

  const primary = periods.find((period) => period.days === selectedDays) ?? periods[0] ?? periods[0]!;
  return { primary, periods };
}

export function buildMultiPeriodAggregate(
  accumulators: ReadonlyMap<number, AggregateAccumulator>,
  windows: readonly PeriodWindow[],
  selectedDays: number,
): MultiPeriodMetrics {
  const periods = windows.map((window) => {
    const acc = accumulators.get(window.days) ?? createAccumulator();
    return finalizePeriodMetrics(acc, window);
  });

  const primary = periods.find((period) => period.days === selectedDays) ?? periods[0] ?? periods[0]!;
  return { primary, periods };
}
