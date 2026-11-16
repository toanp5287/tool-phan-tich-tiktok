import { SNAPSHOT_WINDOW_DAYS } from '../config/constants.js';
import type { RangeAnchor } from './dates.js';
import { clampInt } from './numbers.js';

/**
 * Bộ lọc thời gian toàn cục dùng chung cho mọi trang/phân tích.
 * Hỗ trợ đầy đủ 5 mốc:
 *  - `today`     : Hôm nay / hiện tại
 *  - `yesterday` : Hôm qua
 *  - `7d`        : 7 ngày trước
 *  - `30d`       : 30 ngày trước
 *  - `90d`       : 90 ngày trước
 *
 * Ngoài ra vẫn nhận tham số cũ:
 *  - `range=...` (khuyến nghị cho UI)
 *  - `days=<number>` (tương thích API cũ), `yesterday=true`.
 */
export const TIME_RANGE = {
  TODAY: 'today',
  YESTERDAY: 'yesterday',
  LAST_7_DAYS: '7d',
  LAST_30_DAYS: '30d',
  LAST_90_DAYS: '90d',
} as const;

export type TimeRangeKey = (typeof TIME_RANGE)[keyof typeof TIME_RANGE];

export interface TimeRange {
  /** Khoá bộ lọc đã chuẩn hoá (today | yesterday | 7d | 30d | 90d | custom) */
  key: TimeRangeKey | 'custom';
  /** Số ngày của kỳ hiện tại (>= 1). `today`/`yesterday` = 1. */
  days: number;
  /** Nhãn hiển thị tiếng Việt */
  label: string;
  /** Mốc neo: hôm nay (bao gồm hôm nay) hoặc hôm qua. */
  anchor: RangeAnchor;
  /** Kỳ trước dạng để tính tăng trưởng (cùng độ dài, liền trước kỳ hiện tại) */
  previousDays: number;
}

const RANGE_TO_DAYS: Record<TimeRangeKey, number> = {
  [TIME_RANGE.TODAY]: 1,
  [TIME_RANGE.YESTERDAY]: 1,
  [TIME_RANGE.LAST_7_DAYS]: 7,
  [TIME_RANGE.LAST_30_DAYS]: 30,
  [TIME_RANGE.LAST_90_DAYS]: 90,
};

const RANGE_TO_ANCHOR: Record<TimeRangeKey, RangeAnchor> = {
  [TIME_RANGE.TODAY]: 'today',
  [TIME_RANGE.YESTERDAY]: 'yesterday',
  [TIME_RANGE.LAST_7_DAYS]: 'today',
  [TIME_RANGE.LAST_30_DAYS]: 'today',
  [TIME_RANGE.LAST_90_DAYS]: 'today',
};

const RANGE_LABELS: Record<TimeRangeKey, string> = {
  [TIME_RANGE.TODAY]: 'Hôm nay',
  [TIME_RANGE.YESTERDAY]: 'Hôm qua',
  [TIME_RANGE.LAST_7_DAYS]: '7 ngày qua',
  [TIME_RANGE.LAST_30_DAYS]: '30 ngày qua',
  [TIME_RANGE.LAST_90_DAYS]: '90 ngày qua',
};

function isTimeRangeKey(value: string): value is TimeRangeKey {
  return Object.prototype.hasOwnProperty.call(RANGE_TO_DAYS, value);
}

/**
 * Chuẩn hoá range từ query string. Trả về `null` khi không có tham số hợp lệ
 * để caller tự quyết định fallback (giữ tương thích với code cũ).
 */
export function readTimeRangeQuery(query: {
  range?: unknown;
  days?: unknown;
  yesterday?: unknown;
}): TimeRange | null {
  const rawRange = typeof query.range === 'string' ? query.range.trim().toLowerCase() : '';
  const rawYesterday = query.yesterday;

  if (rawYesterday === 'true' || rawYesterday === '1') {
    return buildRange(TIME_RANGE.YESTERDAY);
  }

  if (rawRange) {
    const normalized =
      rawRange === 'today' || rawRange === 'hom-nay' || rawRange === 'current' || rawRange === 'now'
        ? TIME_RANGE.TODAY
        : rawRange === 'yesterday' || rawRange === 'hom-qua' || rawRange === '1d'
          ? TIME_RANGE.YESTERDAY
          : rawRange === '7' || rawRange === '7days' || rawRange === 'last-7-days'
            ? TIME_RANGE.LAST_7_DAYS
            : rawRange === '30' || rawRange === '30days' || rawRange === 'last-30-days'
              ? TIME_RANGE.LAST_30_DAYS
              : rawRange === '90' || rawRange === '90days' || rawRange === 'last-90-days'
                ? TIME_RANGE.LAST_90_DAYS
                : rawRange;

    if (isTimeRangeKey(normalized)) return buildRange(normalized);
  }

  if (query.days !== undefined && query.days !== null && query.days !== '') {
    const days = clampInt(query.days, 1, SNAPSHOT_WINDOW_DAYS.max, SNAPSHOT_WINDOW_DAYS.default);
    return buildCustomRange(days);
  }

  return null;
}

function buildRange(key: TimeRangeKey): TimeRange {
  return {
    key,
    days: RANGE_TO_DAYS[key],
    label: RANGE_LABELS[key],
    anchor: RANGE_TO_ANCHOR[key],
    previousDays: RANGE_TO_DAYS[key],
  };
}

function buildCustomRange(days: number): TimeRange {
  return {
    key: 'custom',
    days,
    label: `${days} ngày`,
    anchor: 'today',
    previousDays: days,
  };
}

/** Trả về TimeRange với fallback an toàn khi query rỗng. */
export function resolveTimeRange(
  query: { range?: unknown; days?: unknown; yesterday?: unknown },
  fallbackDays: number = SNAPSHOT_WINDOW_DAYS.default,
): TimeRange {
  return (
    readTimeRangeQuery(query) ??
    buildCustomRange(clampInt(fallbackDays, 1, SNAPSHOT_WINDOW_DAYS.max, SNAPSHOT_WINDOW_DAYS.default))
  );
}

export function timeRangeToDays(raw: unknown, fallbackDays: number = SNAPSHOT_WINDOW_DAYS.default): number {
  if (typeof raw === 'string' && isTimeRangeKey(raw.trim().toLowerCase())) {
    return RANGE_TO_DAYS[raw.trim().toLowerCase() as TimeRangeKey];
  }
  return clampInt(raw, 1, SNAPSHOT_WINDOW_DAYS.max, fallbackDays);
}

/** Nhãn + mốc neo suy ra từ khoá range (dùng cho metadata API). */
export function describeTimeRangeKey(key: TimeRangeKey): { label: string; days: number; anchor: RangeAnchor } {
  return {
    label: RANGE_LABELS[key],
    days: RANGE_TO_DAYS[key],
    anchor: RANGE_TO_ANCHOR[key],
  };
}
