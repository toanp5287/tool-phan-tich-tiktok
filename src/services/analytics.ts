export type DataKind = 'VERIFIED' | 'ESTIMATED' | 'SIMULATED' | 'UNKNOWN';
export type DataState = 'OK' | 'INSUFFICIENT_BASELINE' | 'SINGLE_POINT' | 'NO_TIMESTAMP';

export interface Coverage {
  start: string | null;
  end: string | null;
  anchor: 'dataset';
  points: number;
  source: string | null;
}

export interface AnalyticsMeta {
  coverage: Coverage;
  dataKind: DataKind;
  state: DataState;
  method: string | null;
  formula?: string;
  assumptions?: string[];
  limitations?: string[];
  inputs?: Record<string, unknown>;
}

export interface AnalyticsResponse<T> extends AnalyticsMeta { data: T[] }

export interface DatedValue {
  date: string;
  value: number;
}

export const SIMULATED_END_DATE = '2025-07-01';
export const METHOD_ESTIMATED_GMV = 'SOLD_COUNT_X_LATEST_OBSERVED_PRICE_V1';
export const METHOD_SIMULATED_TIMELINE = 'SEEDED_DAILY_TIMELINE_V1';

const DAY_MS = 86_400_000;
const SIMULATED_END_MS = Date.UTC(2025, 6, 1);
export function datasetDay(date: Date): string {
  return new Date(date.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}

export function emptyCoverage(source: string | null = null): Coverage {
  return { start: null, end: null, anchor: 'dataset', points: 0, source };
}

export function coverageFromDates(dates: Array<string | null | undefined>, source: string | null): Coverage {
  const unique = [...new Set(dates.filter((value): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(T.*)?$/.test(value) && Number.isFinite(Date.parse(value))))].sort();
  return {
    start: unique[0] ?? null,
    end: unique.at(-1) ?? null,
    anchor: 'dataset',
    points: unique.length,
    source,
  };
}

export function stateForPoints(points: number): DataState {
  if (points <= 0) return 'NO_TIMESTAMP';
  if (points === 1) return 'SINGLE_POINT';
  return 'OK';
}

export function stateForGrowth(hasBaseline: boolean): DataState {
  return hasBaseline ? 'OK' : 'INSUFFICIENT_BASELINE';
}

export function analyticsMeta(
  dataKind: DataKind,
  coverage: Coverage,
  state: DataState,
  method: string | null,
): AnalyticsMeta {
  return { coverage, dataKind, state, method, ...(method === METHOD_ESTIMATED_GMV ? {
    formula: 'sum(latest soldCount × same-currency listed price) over eligible distinct products',
    inputs: { soldCount: 'latest ProductObservation.soldCount', price: 'latest same-currency ProductObservation.price, otherwise ProductVariant minimum or source priceRange minimum' },
    assumptions: ['soldCount is treated as cumulative units, not orders or period sales', 'Latest listed price approximates historical selling prices; variant minimum is used only when observation price is missing'],
    limitations: ['Not verified GMV; excludes unknown inputs, returns, discounts and cancellations', 'Aggregated monetary values include VND products only; no currency conversion', 'Shop totals cover known linked products only; no dated commerce baseline'],
  } : {}) };
}

export function scalarAnalytics(
  dataKind: DataKind,
  value: number | null,
  source: string | null,
  method: string | null,
): AnalyticsMeta {
  return analyticsMeta(
    value === null ? 'UNKNOWN' : dataKind,
    emptyCoverage(source),
    value === null ? 'INSUFFICIENT_BASELINE' : 'OK',
    value === null ? null : method,
  );
}

export function estimatedGmv(soldCount: number | null, price: number | null): number | null {
  if (soldCount === null || price === null) return null;
  if (!Number.isFinite(soldCount) || !Number.isFinite(price)) return null;
  if (soldCount < 0 || price <= 0) return null;
  const value = soldCount * price;
  return Number.isFinite(value) && value <= Number.MAX_SAFE_INTEGER ? value : null;
}

export function sumNumbers(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return valid.length > 0 ? valid.reduce((total, value) => total + value, 0) : null;
}

function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Tạo chuỗi ngày minh họa ổn định theo entity ID. Tổng các điểm bằng
 * `total` làm tròn theo độ chính xác tiền tệ hoặc số lượng.
 * Không dùng `new Date()` làm mốc lịch sử; mốc cuối cố định 2025-07-01.
 */
export function simulatedDailySeries(seedKey: string, days: number, total: number | null): DatedValue[] {
  const pointCount = Math.max(1, Math.min(90, Number.isFinite(days) ? Math.floor(days) || 30 : 30));
  if (total === null || !Number.isFinite(total) || total <= 0) return [];

  const random = mulberry32(hashString(seedKey));
  const weights = Array.from({ length: pointCount }, () => 0.55 + random() * 0.9);
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const startMs = SIMULATED_END_MS - (pointCount - 1) * DAY_MS;

  const scale = seedKey.includes('sales') ? 1 : 100;
  let cumulative = 0, allocated = 0;
  return weights.map((weight, index) => {
    cumulative += weight;
    const target = Math.round(total * scale * cumulative / weightTotal);
    const value = (target - allocated) / scale;
    allocated = target;
    return { date: isoDay(startMs + index * DAY_MS), value };
  });
}

export function simulatedTimeline(
  seedKey: string,
  days: number,
  total: number | null,
  method = METHOD_SIMULATED_TIMELINE,
): { points: DatedValue[]; analytics: AnalyticsMeta } {
  const points = simulatedDailySeries(seedKey, days, total);
  return {
    points,
    analytics: analyticsMeta(
      points.length > 0 ? 'SIMULATED' : 'UNKNOWN',
      coverageFromDates(points.map((point) => point.date), points.length > 0 ? 'SIMULATED' : null),
      stateForPoints(points.length),
      points.length > 0 ? method : null,
    ),
  };
}

export function datedAnalytics(points: Array<{date: string | null}>, dataKind: DataKind, source: string | null, method: string | null): AnalyticsMeta {
  const coverage = coverageFromDates(points.map((point) => point.date), source);
  return analyticsMeta(
    coverage.points ? dataKind : 'UNKNOWN',
    coverage,
    stateForPoints(coverage.points),
    method,
  );
}
