const SOLD_PATTERN =
  /(?:đã bán|da ban|sold)\s*[:\-]?\s*([\d.,]+\s*[KkMmBb]?)|([\d.,]+\s*[KkMmBb]?)\s*(?:đã bán|da ban|sold)/i;
const SHOP_KEYWORDS = /(shop|store|official|flagship|chính hãng|authorized)/i;
const PRICE_PATTERN = /(\d[\d.,]*)\s*(?:₫|đ|vnd|vnđ)/i;

export interface DailySeriesPoint {
  date: string;
  value: number;
}

export function sortSeriesAscending(points: DailySeriesPoint[]): DailySeriesPoint[] {
  return [...points].sort((a, b) => a.date.localeCompare(b.date));
}

export function extractSoldFromText(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = text.match(SOLD_PATTERN);
  if (!match) return null;

  const raw = (match[1] ?? match[2] ?? '').replace(/[.,](?=\d{3}\b)/g, '');
  const suffix = raw.slice(-1).toLowerCase();
  const multiplier = suffix === 'k' ? 1_000 : suffix === 'm' ? 1_000_000 : suffix === 'b' ? 1_000_000_000 : 1;
  const numeric = Number.parseFloat(multiplier === 1 ? raw : raw.slice(0, -1));

  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric * multiplier);
}

export function extractPriceFromText(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = text.match(PRICE_PATTERN);
  const captured = match?.[1];
  if (!captured) return null;

  const cleaned = captured.replace(/[.,](?=\d{3}\b)/g, '').replace(/,/g, '.');
  const numeric = Number.parseFloat(cleaned);
  return Number.isFinite(numeric) ? numeric : null;
}

export function looksLikeShop(name: string | null | undefined): boolean {
  if (!name) return false;
  return SHOP_KEYWORDS.test(name) || name.length > 2;
}

export function buildKeywordCloud(
  items: Array<{ keywords: string[] | null; content: string }>,
  limit = 15,
): Array<{ keyword: string; count: number }> {
  const counts = new Map<string, number>();

  for (const item of items) {
    const keywords = new Set<string>();

    for (const keyword of item.keywords ?? []) {
      const normalized = keyword.trim().toLowerCase();
      if (normalized) keywords.add(normalized);
    }

    for (const match of item.content.matchAll(/#([\p{L}\p{N}_]+)/gu)) {
      const captured = match[1];
      if (captured) keywords.add(captured.toLowerCase());
    }

    for (const keyword of keywords) {
      counts.set(keyword, (counts.get(keyword) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .map(([keyword, count]) => ({ keyword, count }))
    .sort((a, b) => b.count - a.count || a.keyword.localeCompare(b.keyword))
    .slice(0, Math.max(1, limit));
}

export function computeEma(values: number[], period = 7): number[] {
  const first = values[0];
  if (first === undefined) return [];

  const multiplier = 2 / (period + 1);
  const output: number[] = [first];

  for (let index = 1; index < values.length; index += 1) {
    const current = values[index] ?? 0;
    const previous = output[index - 1] ?? current;
    output.push(current * multiplier + previous * (1 - multiplier));
  }

  return output;
}

export function linearRegressionForecast(values: number[], horizon = 7): number[] {
  if (values.length < 2) return [];

  const n = values.length;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((sum, value) => sum + value, 0) / n;

  let numerator = 0;
  let denominator = 0;

  for (let index = 0; index < n; index += 1) {
    const deviation = index - meanX;
    numerator += deviation * ((values[index] ?? 0) - meanY);
    denominator += deviation ** 2;
  }

  const slope = denominator === 0 ? 0 : numerator / denominator;
  const intercept = meanY - slope * meanX;

  return Array.from({ length: Math.max(0, horizon) }, (_item, offset) => {
    const x = n + offset;
    return Math.max(0, intercept + slope * x);
  });
}
