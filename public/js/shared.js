/* ==========================================================================
   Lớp tiện ích dùng chung cho toàn bộ dashboard (ES module, không cần build)
   ========================================================================== */

import { registerChartState } from './chart-state.js';
import { injectShell } from './shell.js';
registerChartState();
export const VI = "vi-VN";
const preserveAiReportFormatting = typeof window !== 'undefined' && window.location.pathname.endsWith('/ai-analysis.html');
export function knownSum(values) {
  const valid = values.filter(value => typeof value === 'number' && Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) : null;
}

/* ---------------- Bộ lọc thời gian toàn cục ---------------- */

export const TIME_RANGES = [
  { key: "today", days: 1, label: "Hôm nay", short: "Hôm nay" },
  { key: "yesterday", days: 1, label: "Hôm qua", short: "Hôm qua" },
  { key: "7d", days: 7, label: "7 ngày qua", short: "7N" },
  { key: "30d", days: 30, label: "30 ngày qua", short: "30N" },
  { key: "90d", days: 90, label: "90 ngày qua", short: "90N" },
];

export const DEFAULT_RANGE_KEY = "30d";

export function rangeKeyToDays(key) {
  const found = TIME_RANGES.find((option) => option.key === key);
  return found ? found.days : 30;
}

export function rangeKeyFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const raw = (params.get("range") || "").trim().toLowerCase();
  if (TIME_RANGES.some((option) => option.key === raw)) return raw;

  const days = Number.parseInt(params.get("days") || "", 10);
  if (Number.isFinite(days) && days > 0) {
    const match = TIME_RANGES.find((option) => option.days === days);
    return match ? match.key : DEFAULT_RANGE_KEY;
  }

  return DEFAULT_RANGE_KEY;
}

export function setRangeInUrl(key) {
  const url = new URL(window.location.href);
  url.searchParams.set("range", key);
  url.searchParams.delete("days");
  window.history.replaceState({}, "", url);
}

/** Tham số truy vấn chuẩn cho API khi dùng range key. */
export function rangeParams(key) {
  return { range: key, days: rangeKeyToDays(key), anchor: 'latest' };
}

/* ---------------- Định dạng ---------------- */

export function formatCurrency(value, options = {}) {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return preserveAiReportFormatting ? options.zeroLabel ?? "0 ₫" : "—";
  if (amount === 0) return options.zeroLabel ?? "0 ₫";

  const compact = options.compact ?? false;
  const currency = options.currency ?? "VND";
  if (compact) return `${formatCompact(amount)} ${currency === "VND" ? "₫" : currency}`;

  return new Intl.NumberFormat(VI, {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "VND" ? 0 : 2,
  }).format(amount);
}

export function formatNumber(value, options = {}) {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return preserveAiReportFormatting ? options.zeroLabel ?? "0" : "—";
  if (options.compact) return formatCompact(amount);

  return new Intl.NumberFormat(VI, { maximumFractionDigits: 0 }).format(amount);
}

export function formatCompact(value) {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return preserveAiReportFormatting ? "0" : "—";

  const abs = Math.abs(amount);
  if (abs >= 1_000_000_000) return `${trimZero(amount / 1_000_000_000)}B`;
  if (abs >= 1_000_000) return `${trimZero(amount / 1_000_000)}M`;
  if (abs >= 1_000) return `${trimZero(amount / 1_000)}K`;
  return new Intl.NumberFormat(VI, { maximumFractionDigits: 0 }).format(amount);
}

function trimZero(value) {
  return Number(value.toFixed(1)).toString();
}

export function formatPercent(value, options = {}) {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return preserveAiReportFormatting ? "0%" : "—";
  const sign = options.sign && amount > 0 ? "+" : "";
  return `${sign}${amount.toFixed(Math.abs(amount) < 10 ? 1 : 0)}%`;
}

export function formatDate(value, style = "short") {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  if (style === "time") {
    return new Intl.DateTimeFormat(VI, { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }).format(date);
  }

  if (style === "long") {
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

export function formatRelative(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  const diffSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  const divisions = [
    { amount: 60, unit: "second" },
    { amount: 60, unit: "minute" },
    { amount: 24, unit: "hour" },
    { amount: 7, unit: "day" },
    { amount: 4.34524, unit: "week" },
    { amount: 12, unit: "month" },
    { amount: Number.POSITIVE_INFINITY, unit: "year" },
  ];

  let duration = diffSeconds;
  try {
    const formatter = new Intl.RelativeTimeFormat(VI, { numeric: "auto" });
    for (const division of divisions) {
      if (Math.abs(duration) < division.amount) {
        return formatter.format(Math.round(duration), division.unit);
      }
      duration /= division.amount;
    }
  } catch {
    return formatDate(value);
  }

  return formatDate(value);
}

export function formatDuration(durationMs) {
  const ms = Number(durationMs);
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m ${totalSeconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
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

export function growthClass(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || Math.abs(amount) < 0.5) return "pill pill-neutral";
  return amount > 0 ? "pill pill-positive" : "pill pill-negative";
}

export function growthIcon(value) {
  if (value === null || value === undefined) return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount) || Math.abs(amount) < 0.5) return "→";
  return amount > 0 ? "▲" : "▼";
}

export async function apiGet(path, params = {}) {
  const url = new URL(path, window.location.origin);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const body = await response.json().catch(() => null);

  if (!response.ok || !body?.success) {
    throw new Error(body?.error?.message ?? `Yêu cầu thất bại (${response.status})`);
  }

  return body;
}

export function toQueryState(entries) {
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(entries)) {
    if (value === undefined || value === null || value === "" || value === false) params.delete(key);
    else params.set(key, String(value));
  }
  const query = params.toString();
  return `${window.location.pathname}${query ? `?${query}` : ""}`;
}

export function debounce(fn, delay = 320) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/* ---------------- Drill-down URL helpers ---------------- */

export function readQuery(name) {
  const value = new URLSearchParams(window.location.search).get(name);
  return value ? value.trim() : "";
}

export function categoryUrl(category) {
  return `/category.html?name=${encodeURIComponent(category)}`;
}

export function subCategoryUrl(category, subCategory) {
  return `/subcategory.html?category=${encodeURIComponent(category)}&name=${encodeURIComponent(subCategory)}`;
}

export function shopUrl(shopId, context = {}) {
  const params = new URLSearchParams({ id: String(shopId) });
  if (context.category) params.set("category", context.category);
  if (context.subCategory) params.set("sub", context.subCategory);
  return `/shop-detail.html?${params.toString()}`;
}

export function shortLabel(text, max = 18) {
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function dayLabel(isoDate) {
  if (!isoDate) return '—';
  const date = new Date(isoDate);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(VI, { day: "2-digit", month: "2-digit", timeZone: 'Asia/Ho_Chi_Minh' }).format(date);
}

/* ---------------- Chart.js helpers ---------------- */

export const CHART_COLORS = {
  accent: "#2563eb",
  accentSoft: "rgba(37, 99, 235, 0.16)",
  violet: "#1d4ed8",
  violetSoft: "rgba(29, 78, 216, 0.16)",
  cyan: "#0891b2",
  cyanSoft: "rgba(8, 145, 178, 0.16)",
  emerald: "#16a34a",
  amber: "#d97706",
  grid: "rgba(15, 23, 42, 0.07)",
  tick: "#64748b",
};

export function gradientFill(context, hexColor, topOpacity = 0.42) {
  const { chart } = context;
  const { ctx, chartArea } = chart;
  if (!chartArea) return "transparent";

  const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
  gradient.addColorStop(0, hexToRgba(hexColor, topOpacity));
  gradient.addColorStop(1, hexToRgba(hexColor, 0));
  return gradient;
}

export function hexToRgba(hex, alpha) {
  const normalized = hex.replace("#", "");
  const bigint = Number.parseInt(normalized.length === 3 ? normalized.split("").map((c) => c + c).join("") : normalized, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export const BASE_OPTIONS = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: "index", intersect: false },
  animation: { duration: 650 },
  plugins: {
    legend: {
      display: true,
      labels: {
        color: CHART_COLORS.tick,
        usePointStyle: true,
        pointStyle: "circle",
        boxWidth: 7,
        boxHeight: 7,
        padding: 16,
        font: { size: 11, family: "'Inter', system-ui, sans-serif", weight: "500" },
      },
    },
    tooltip: {
      backgroundColor: "rgba(255, 255, 255, 0.98)",
      borderColor: "rgba(15, 23, 42, 0.12)",
      borderWidth: 1,
      titleColor: "#0f172a",
      bodyColor: "#475569",
      padding: 12,
      cornerRadius: 10,
      displayColors: true,
      boxWidth: 7,
      boxHeight: 7,
      usePointStyle: true,
      titleFont: { size: 12, weight: "600" },
      bodyFont: { size: 12 },
    },
  },
  scales: {
    x: {
      grid: { display: false },
      border: { display: false },
      ticks: { color: CHART_COLORS.tick, font: { size: 10.5 }, maxRotation: 0, autoSkipPadding: 18 },
    },
    y: {
      beginAtZero: true,
      grid: { color: CHART_COLORS.grid, drawTicks: false },
      border: { display: false },
      ticks: { color: CHART_COLORS.tick, font: { size: 10.5 }, padding: 8, maxTicksLimit: 6, callback: compactTick },
    },
  },
};

function compactTick(value) {
  return formatCompact(value);
}

export function lineDataset(label, data, colorHex, options = {}) {
  return {
    label,
    data,
    borderColor: colorHex,
    backgroundColor: (context) => gradientFill(context, colorHex, options.fillOpacity ?? 0.4),
    borderWidth: 2,
    pointRadius: 0,
    pointHoverRadius: 5,
    pointHoverBackgroundColor: colorHex,
    pointHoverBorderColor: "#ffffff",
    pointHoverBorderWidth: 2,
    fill: options.fill ?? true,
    tension: 0.38,
    borderCapStyle: "round",
  };
}

export function barDataset(label, data, colors) {
  const palette = Array.isArray(colors) ? colors : [colors];
  return {
    label,
    data,
    backgroundColor: data.map((_, index) => hexToRgba(palette[index % palette.length], 0.75)),
    hoverBackgroundColor: data.map((_, index) => palette[index % palette.length]),
    borderColor: data.map((_, index) => palette[index % palette.length]),
    borderWidth: 1,
    borderRadius: 8,
    borderSkipped: false,
    maxBarThickness: 46,
  };
}

export function destroyChart(existing) {
  if (existing && typeof existing.destroy === "function") existing.destroy();
}

/* ==========================================================================
   Component bộ lọc thời gian toàn cục (Vue global component)
   Dùng trong template: <time-filter :model-value="range" @update:model-value="setRange" />
   ========================================================================== */

export const TimeFilter = {
  name: "TimeFilter",
  props: {
    modelValue: { type: String, default: DEFAULT_RANGE_KEY },
  },
  emits: ["update:model-value"],
  data() {
    return { ranges: TIME_RANGES };
  },
  methods: {
    pick(key) {
      if (key === this.modelValue) return;
      this.$emit("update:model-value", key);
    },
  },
  template: `
    <div class="segmented" role="group" aria-label="Bộ lọc thời gian">
      <button
        v-for="option in ranges"
        :key="option.key"
        type="button"
        :class="{ 'is-active': modelValue === option.key }"
        :aria-pressed="modelValue === option.key"
        :title="option.label"
        @click="pick(option.key)"
      >{{ option.short }}</button>
    </div>
  `,
};

export function registerGlobalComponents(app) {
  app.component("time-filter", TimeFilter);
}

/**
 * Tạo app Vue đã đăng ký sẵn các component toàn cục (time-filter) và mount.
 * Dùng thay cho createApp({...}).mount("#app").
 */
export function mountApp(options, selector = "#app") {
  const app = Vue.createApp(options);
  registerGlobalComponents(app);
  const container = document.querySelector(selector);
  if (container) injectShell(container);
  if (/(shop|detail|shops|shop-detail|categories|category|subcategory|creator|creators|trends|trend-analysis|price-segments)\.html$/.test(window.location.pathname)) {
    const notice = document.createElement('p');
    notice.className = 'alert';
    notice.setAttribute('role', 'note');
    notice.textContent = 'GMV: ƯỚC TÍNH lũy kế từ số bán × giá niêm yết; tổng tiền chỉ gồm VND. Không có timestamp thương mại để vẽ lịch sử hay tính tăng trưởng. Creator GMV và nguồn doanh thu: UNKNOWN. Social là số đo tích lũy nguồn học thuật chưa xác minh độc lập; không phải doanh số trong kỳ.';
    container?.before(notice);
  }
  return app.mount(selector);
}
