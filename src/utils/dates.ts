const MS_PER_DAY = 86_400_000;

/** Mốc đầu ngày theo UTC (dùng làm bucketDate, khớp cột DATE trong PostgreSQL). */
export function startOfUtcDay(value: Date = new Date()): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export function toBucketDate(value: Date = new Date()): Date {
  return startOfUtcDay(value);
}

export function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * MS_PER_DAY);
}

export function daysAgo(days: number, from: Date = new Date()): Date {
  return startOfUtcDay(addDays(from, -Math.max(0, Math.trunc(days))));
}

export function diffInDays(from: Date, to: Date): number {
  return Math.round((startOfUtcDay(to).getTime() - startOfUtcDay(from).getTime()) / MS_PER_DAY);
}

export function isoDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function eachDay(from: Date, to: Date): Date[] {
  const start = startOfUtcDay(from);
  const end = startOfUtcDay(to);
  const total = diffInDays(start, end);

  if (total < 0) return [];

  return Array.from({ length: total + 1 }, (_item, index) => addDays(start, index));
}

export interface AnalyticsWindow {
  /** Số ngày của kỳ hiện tại */
  days: number;
  /** Bắt đầu kỳ hiện tại (UTC, inclusive) */
  currentStart: Date;
  /** Kết thúc kỳ hiện tại (inclusive) */
  currentEnd: Date;
  /** Bắt đầu kỳ trước (UTC, inclusive) */
  previousStart: Date;
  /** Kết thúc kỳ trước (exclusive so với currentStart) */
  previousEnd: Date;
  /** Danh sách ngày của kỳ hiện tại để vẽ timeline */
  daysList: Date[];
}

/** Mốc neo của cửa sổ thời gian: hôm nay (bao gồm hôm nay) hoặc hôm qua. */
export type RangeAnchor = 'today' | 'yesterday';

/**
 * Xây dựng cửa sổ phân tích chuẩn cho bộ lọc thời gian toàn cục.
 *
 * - `days = 1`, anchor `today`     -> đúng ngày hôm nay (00:00 UTC -> hiện tại)
 * - `days = 1`, anchor `yesterday` -> đúng ngày hôm qua (00:00 -> 23:59:59 UTC hôm qua)
 * - `days > 1`                     -> cửa sổ trượt N ngày tính đến mốc neo (bao gồm mốc neo)
 */
export function buildAnalyticsWindow(
  days: number,
  now: Date = new Date(),
  anchor: RangeAnchor = 'today',
): AnalyticsWindow {
  const safeDays = Math.max(1, Math.trunc(days));
  const todayStart = startOfUtcDay(now);
  const anchorDay = anchor === 'yesterday' ? addDays(todayStart, -1) : todayStart;
  const currentEnd = anchor === 'yesterday' ? new Date(todayStart.getTime() - 1) : now;

  if (safeDays === 1) {
    return {
      days: 1,
      currentStart: anchorDay,
      currentEnd,
      previousStart: addDays(anchorDay, -1),
      previousEnd: new Date(anchorDay.getTime() - 1),
      daysList: [anchorDay],
    };
  }

  const currentStart = addDays(anchorDay, -(safeDays - 1));

  return {
    days: safeDays,
    currentStart,
    currentEnd,
    previousStart: addDays(currentStart, -safeDays),
    previousEnd: new Date(currentStart.getTime() - 1),
    daysList: eachDay(currentStart, anchorDay),
  };
}

export function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

export function parseDateInput(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return isValidDate(value) ? value : null;

  const raw = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(raw)) return null;

  const parsed = new Date(raw);
  return isValidDate(parsed) ? parsed : null;
}

export function formatDuration(durationMs: number | null | undefined): string {
  if (!durationMs || durationMs < 0) return '0s';
  const totalSeconds = Math.round(durationMs / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;

  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}
