import { registerChartState } from '../../js/chart-state.js';
registerChartState();
/** Helper Chart.js cho light theme. */

export const CHART_COLORS = {
  brand: "#2563eb",
  brandSoft: "rgba(37, 99, 235, 0.16)",
  cyan: "#0891b2",
  cyanSoft: "rgba(8, 145, 178, 0.16)",
  green: "#16a34a",
  greenSoft: "rgba(22, 163, 74, 0.16)",
  amber: "#d97706",
  amberSoft: "rgba(217, 119, 6, 0.16)",
  pink: "#7c3aed",
  pinkSoft: "rgba(124, 58, 237, 0.16)",
  grid: "rgba(20, 26, 46, 0.07)",
  tick: "#8b93a7",
};

export function hexToRgba(hex, alpha) {
  const normalized = hex.replace("#", "");
  const bigint = Number.parseInt(
    normalized.length === 3
      ? normalized
          .split("")
          .map((char) => char + char)
          .join("")
      : normalized,
    16,
  );
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function gradientFill(context, hexColor, topOpacity = 0.28) {
  const { chart } = context;
  const { ctx, chartArea } = chart;
  if (!chartArea) return "transparent";

  const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
  gradient.addColorStop(0, hexToRgba(hexColor, topOpacity));
  gradient.addColorStop(1, hexToRgba(hexColor, 0));
  return gradient;
}

export function baseOptions(overrides = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    animation: { duration: 500 },
    plugins: {
      legend: {
        display: false,
        labels: {
          color: CHART_COLORS.tick,
          usePointStyle: true,
          pointStyle: "circle",
          boxWidth: 7,
          boxHeight: 7,
          padding: 14,
          font: { size: 11, family: "'Inter', system-ui, sans-serif", weight: "500" },
        },
      },
      tooltip: {
        backgroundColor: "rgba(255, 255, 255, 0.98)",
        borderColor: "rgba(15, 23, 42, 0.12)",
        borderWidth: 1,
        titleColor: "#0f172a",
        bodyColor: "#475569",
        padding: 11,
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
        ticks: {
          color: CHART_COLORS.tick,
          font: { size: 10.5 },
          padding: 8,
          maxTicksLimit: 6,
          callback: (value) => compact(value),
        },
      },
    },
    ...overrides,
  };
}

function compact(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return value;
  const abs = Math.abs(amount);
  if (abs >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(amount / 1_000).toFixed(1)}K`;
  return amount;
}

export function lineDataset(label, data, colorHex, options = {}) {
  return {
    label,
    data,
    borderColor: colorHex,
    backgroundColor: (context) => gradientFill(context, colorHex, options.fillOpacity ?? 0.28),
    borderWidth: 2,
    pointRadius: 0,
    pointHoverRadius: 5,
    pointHoverBackgroundColor: colorHex,
    pointHoverBorderColor: "#ffffff",
    pointHoverBorderWidth: 2,
    fill: options.fill ?? true,
    tension: 0.36,
    borderCapStyle: "round",
  };
}

export function barDataset(label, data, colors) {
  const palette = Array.isArray(colors) ? colors : [colors];
  return {
    label,
    data,
    backgroundColor: data.map((_, index) => hexToRgba(palette[index % palette.length], 0.8)),
    hoverBackgroundColor: data.map((_, index) => palette[index % palette.length]),
    borderRadius: 7,
    borderSkipped: false,
    maxBarThickness: 40,
  };
}

export function destroyChart(chart) {
  if (chart && typeof chart.destroy === "function") chart.destroy();
}
