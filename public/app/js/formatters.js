import { formatCurrency as formatVnd } from "./format.js";

/** Null-safe display helpers for the Vue browser modules. */
export function safeNumber(value, options = {}) {
  const fallback = options.fallback ?? "—";
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return new Intl.NumberFormat("vi-VN", {
    maximumFractionDigits: options.maximumFractionDigits ?? 0,
    notation: options.compact ? "compact" : "standard",
    compactDisplay: "short",
  }).format(number);
}

export function safeFixed(value, digits = 2, fallback = "—") {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return number.toFixed(Math.max(0, Math.min(20, Math.trunc(digits))));
}

export function safeCurrency(value, compact = false, fallback = "—") {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return formatVnd(number, compact);
}
