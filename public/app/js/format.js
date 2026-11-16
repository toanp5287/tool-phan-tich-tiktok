export const VI = "vi-VN";

export const TIME_RANGES = [
  { key: "today", days: 1, label: "Hôm nay", short: "Hôm nay" },
  { key: "yesterday", days: 1, label: "Hôm qua", short: "Hôm qua" },
  { key: "7d", days: 7, label: "7 ngày qua", short: "7N" },
  { key: "30d", days: 30, label: "30 ngày qua", short: "30N" },
  { key: "90d", days: 90, label: "90 ngày qua", short: "90N" },
];

export const DEFAULT_RANGE = "30d";

export function daysForRange(key) {
  return TIME_RANGES.find((range) => range.key === key)?.days ?? 30;
}

export function formatCurrency(value, compact = false, currency = "VND") {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  if (!currency || !/^[A-Z]{3}$/.test(currency)) return "—";
  if (compact) return `${formatCompact(amount)} ${currency === "VND" ? "₫" : currency}`;
  return new Intl.NumberFormat(VI, {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "VND" ? 0 : 2,
  }).format(amount);
}

export function formatNumber(value, compact = false) {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  if (compact) return formatCompact(amount);
  return new Intl.NumberFormat(VI, { maximumFractionDigits: 0 }).format(amount);
}

export function formatCompact(value) {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  const abs = Math.abs(amount);
  if (abs >= 1_000_000_000) return `${trim(amount / 1_000_000_000)}B`;
  if (abs >= 1_000_000) return `${trim(amount / 1_000_000)}M`;
  if (abs >= 1_000) return `${trim(amount / 1_000)}K`;
  return new Intl.NumberFormat(VI, { maximumFractionDigits: 0 }).format(amount);
}

function trim(value) {
  return Number(value.toFixed(1)).toString();
}

export function formatPercent(value, signed = false) {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  const normalized = Math.abs(amount) < 0.05 ? 0 : amount;
  const sign = signed && normalized > 0 ? "+" : "";
  return `${sign}${normalized.toFixed(Math.abs(normalized) < 10 ? 1 : 0)}%`;
}

export function formatDate(value, withTime = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  if (withTime) {
    return new Intl.DateTimeFormat(VI, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }
  return new Intl.DateTimeFormat(VI, { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

export function dayLabel(isoDate) {
  if (!isoDate) return "";
  const date = new Date(isoDate);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(VI, { day: "2-digit", month: "2-digit", timeZone: 'Asia/Ho_Chi_Minh' }).format(date);
}

export function initials(name) {
  if (!name) return "?";
  return name
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

/** Mũi tên + màu theo hướng tăng trưởng. */
export function growthMeta(metric) {
  if (!metric?.hasBaseline) return { direction: "unknown", arrow: "—", label: "Chưa đủ lịch sử", rate: "—", gmvDelta: "—", hasBaseline: false };
  const direction = metric?.direction ?? "flat";
  return {
    direction,
    arrow: direction === "up" ? "▲" : direction === "down" ? "▼" : "→",
    label:
      direction === "up" ? "Tăng trưởng" : direction === "down" ? "Sụt giảm" : "Ổn định",
    rate: formatPercent(metric?.growthRate, true),
    gmvDelta: formatCurrency(metric?.delta, true),
    hasBaseline: Boolean(metric?.hasBaseline),
  };
}

/** Lấy metric GMV ở mốc được chọn; không tự tạo baseline/0% khi thiếu dữ liệu. */
export function primaryMetric(growth) {
  return growth?.primary?.gmv ?? growth?.primary ?? {
    current: null,
    previous: null,
    delta: null,
    growthRate: null,
    direction: "unknown",
    hasData: false,
    hasBaseline: false,
  };
}

export function growthRateOf(entity) {
  return primaryMetric(entity?.growth).growthRate ?? null;
}

export const DATA_KIND_LABELS = {
  VERIFIED: "Đã xác minh",
  ESTIMATED: "Ước tính",
  SIMULATED: "Mô phỏng",
  UNKNOWN: "Chưa xác định",
};

export const DATA_STATE_LABELS = {
  OK: "Đủ dữ liệu",
  INSUFFICIENT_BASELINE: "Chưa đủ lịch sử",
  SINGLE_POINT: "Chỉ có 1 mốc",
  NO_TIMESTAMP: "Không có mốc thời gian",
};

export function dataKindLabel(kind) {
  return DATA_KIND_LABELS[kind] ?? DATA_KIND_LABELS.UNKNOWN;
}

export function dataStateLabel(state) {
  return DATA_STATE_LABELS[state] ?? DATA_STATE_LABELS.INSUFFICIENT_BASELINE;
}

export function dataKindClass(kind) {
  return `kind-${String(kind ?? "UNKNOWN").toLowerCase()}`;
}

export function analyticsSummary(analytics) {
  if (!analytics) return { kind: "UNKNOWN", state: "INSUFFICIENT_BASELINE", label: DATA_KIND_LABELS.UNKNOWN, stateLabel: DATA_STATE_LABELS.INSUFFICIENT_BASELINE };
  return {
    kind: analytics.dataKind ?? "UNKNOWN",
    state: analytics.state ?? "INSUFFICIENT_BASELINE",
    label: dataKindLabel(analytics.dataKind),
    stateLabel: dataStateLabel(analytics.state),
  };
}
