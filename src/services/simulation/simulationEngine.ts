/**
 * Controlled synthetic history generation for the 90-day analytics window.
 *
 * DELIBERATELY SIMULATED — never presented as real TikTok data.
 * Every generated MetricSnapshot row carries source='simulated' and metadata
 * { sourceType:'SIMULATED', scenario, generationVersion, anchor... }.
 * Verified rows (source='dataset-v2' | 'vitied') are never overwritten because
 * the upsert key includes `source`.
 *
 * Generation is deterministic per (entityId, metric) via a seeded PRNG so
 * re-running produces identical values (idempotent, no duplicates).
 */

import { createHash } from 'node:crypto';

export const SIMULATION_SOURCE = 'simulated';
export const GENERATION_VERSION = 'sim-v1';

export type Scenario =
  | 'EMERGING'
  | 'RAPID_GROWTH'
  | 'STABLE'
  | 'SEASONAL'
  | 'DECLINING'
  | 'SATURATED';

export type MarketStructure = 'HIGHLY_CONCENTRATED' | 'MODERATE' | 'FRAGMENTED' | 'EMERGING_COMPETITORS';
export type AffiliateProfile = 'STRONG_AFFILIATE' | 'LOW_AFFILIATE';

export interface SimulationProfile {
  scenario: Scenario;
  /** Cumulative soldCount anchor (latest real observation, or fallback). */
  anchorSold: number;
  /** Anchor price (real observation or variant min). */
  anchorPrice: number;
}

export interface SimPoint {
  bucketDate: string; // YYYY-MM-DD
  soldCount: number; // cumulative units
  price: number;
  gmv: number; // cumulative estimated GMV = cumulative sold × price (matches estimatedGmv convention)
  dailyUnits: number;
}

const DAY_MS = 86_400_000;

/** Deterministic 32-bit PRNG (mulberry32) seeded from a string key. */
function seededRandom(seed: string): () => number {
  const hash = createHash('sha256').update(seed).digest();
  let a = hash.readUInt32LE(0) >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Normalized day-shape 0..1 for a scenario at day index i (0 = oldest). */
function shape(scenario: Scenario, i: number, n: number, rnd: () => number): number {
  const t = n <= 1 ? 1 : i / (n - 1); // 0..1 across window
  // Base drift profile per scenario.
  let base: number;
  switch (scenario) {
    case 'EMERGING':
      base = 0.15 + 0.85 * Math.pow(t, 1.6); // late ramp
      break;
    case 'RAPID_GROWTH':
      base = 0.2 + 0.8 * Math.pow(t, 1.25);
      break;
    case 'STABLE':
      base = 1.0;
      break;
    case 'SEASONAL':
      base = 0.65 + 0.7 * (0.5 + 0.5 * Math.sin((t - 0.35) * Math.PI * 2)); // one peak/trough
      break;
    case 'DECLINING':
      base = 1.2 - 0.75 * t;
      break;
    case 'SATURATED':
      base = 0.9 - 0.25 * Math.pow(t, 2) + 0.1 * Math.sin(t * 6);
      break;
    default:
      base = 1.0;
  }
  // Weekly rhythm (weekday vs weekend) + bounded noise.
  const weekday = (i % 7) + 1; // 1=Mon..7=Sun
  const weekend = weekday >= 6 ? 1.18 : 1.0;
  const noise = 0.85 + rnd() * 0.3; // 0.85..1.15
  return Math.max(0.02, base * weekend * noise);
}

/**
 * Build a 90-day cumulative series whose FINAL value equals anchorSold and whose
 * daily increments follow the scenario shape. Price is a gentle bounded walk
 * around anchorPrice (anchor price is the last-day price).
 */
export function simulateSeries(
  profile: SimulationProfile,
  days: number,
  endDate: Date,
  seedKey: string,
): SimPoint[] {
  const n = Math.max(1, Math.trunc(days));
  const endMs = endDate.getTime();
  const startMs = endMs - (n - 1) * DAY_MS;
  const rnd = seededRandom(seedKey + ':' + GENERATION_VERSION);

  // Daily-unit weights (relative demand per day).
  const weights: number[] = [];
  for (let i = 0; i < n; i++) weights.push(shape(profile.scenario, i, n, rnd));
  const weightTotal = weights.reduce((a, b) => a + b, 0) || 1;

  // Scale so the sum of daily units equals anchorSold (cumulative = anchorSold at day n-1).
  const totalUnits = Math.max(0, profile.anchorSold);

  // Largest-remainder allocation: daily units are non-negative integers summing
  // EXACTLY to totalUnits, so the cumulative series is monotonic and ends exactly
  // at the anchor (no downward rounding correction).
  const rawUnits = weights.map((w) => (w / weightTotal) * totalUnits);
  const floored = rawUnits.map((v) => Math.floor(v));
  const remainder = totalUnits - floored.reduce((a, b) => a + b, 0);
  // Distribute the remainder to the largest fractional parts (stable, deterministic).
  const order = rawUnits
    .map((v, i) => ({ frac: v - Math.floor(v), i }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const dailyUnitsArray = floored.slice();
  for (let k = 0; k < remainder; k++) {
    const target = order[k % order.length];
    if (target) dailyUnitsArray[target.i] = (dailyUnitsArray[target.i] ?? 0) + 1;
  }

  // Price walk: deterministic, bounded, ends at anchorPrice.
  const prices: number[] = new Array(n);
  prices[n - 1] = Math.max(1, profile.anchorPrice);
  // Backward-ish: build forward then renormalize to anchorPrice.
  let p = Math.max(1, profile.anchorPrice * (0.94 + rnd() * 0.12));
  const forward: number[] = [];
  for (let i = 0; i < n; i++) {
    forward.push(p);
    const drift = (rnd() - 0.5) * 0.03; // ±1.5% per day
    const meanReversion = (profile.anchorPrice - p) * 0.02;
    p = Math.max(1, p * (1 + drift) + meanReversion);
  }
  const lastForward = forward[n - 1] ?? profile.anchorPrice;
  const scale = profile.anchorPrice / lastForward;
  for (let i = 0; i < n; i++) prices[i] = roundMoney((forward[i] ?? profile.anchorPrice) * scale);

  const points: SimPoint[] = [];
  let cumulative = 0;
  let cumulativeGmv = 0;
  for (let i = 0; i < n; i++) {
    const dailyUnits = dailyUnitsArray[i] ?? 0;
    cumulative += dailyUnits;
    const price = prices[i] ?? profile.anchorPrice;
    cumulativeGmv += dailyUnits * price;
    const date = new Date(startMs + i * DAY_MS);
    points.push({
      bucketDate: date.toISOString().slice(0, 10),
      soldCount: cumulative,
      price,
      gmv: roundMoney(cumulativeGmv),
      dailyUnits,
    });
  }
  // Monotonic by construction; final cumulative == totalUnits exactly.
  return points;
}

/** Pick a scenario deterministically from a product/shop id. */
export function scenarioForKey(key: string): Scenario {
  const hash = createHash('sha256').update(key).digest().readUInt32LE(0);
  const SCENARIOS: Scenario[] = ['STABLE', 'RAPID_GROWTH', 'EMERGING', 'SEASONAL', 'DECLINING', 'SATURATED'];
  return SCENARIOS[hash % SCENARIOS.length] ?? 'STABLE';
}

export interface CompetitionPoint {
  bucketDate: string;
  /** Market share of the largest shop (0..1). */
  topShopShare: number;
  /** Herfindahl-Hirschman Index concentration (sum of squared shares, 0..1). */
  hhi: number;
  /** Number of known (verified, active) competing shops. */
  shopCount: number;
  /** Per-shop shares aligned with `shopIds`, summing to ~1. */
  shares: number[];
}

export function marketStructureForKey(key: string): MarketStructure {
  const v = createHash('sha256').update('market:' + key).digest().readUInt32LE(0) % 4;
  return (['HIGHLY_CONCENTRATED', 'MODERATE', 'FRAGMENTED', 'EMERGING_COMPETITORS'] as const)[v] ?? 'MODERATE';
}

export function affiliateProfileForKey(key: string): AffiliateProfile {
  return createHash('sha256').update('affiliate:' + key).digest().readUInt32LE(0) % 3 === 0
    ? 'STRONG_AFFILIATE'
    : 'LOW_AFFILIATE';
}

export function syntheticShopCountForKey(key: string): number {
  const structure = marketStructureForKey(key);
  if (structure === 'HIGHLY_CONCENTRATED') return 2;
  if (structure === 'MODERATE') return 3;
  if (structure === 'FRAGMENTED') return 5;
  return 4;
}

export function syntheticCreatorCountForKey(key: string): number {
  return 2 + (createHash('sha256').update('creators:' + key).digest().readUInt32LE(0) % 3);
}

/**
 * Simulate a time-varying market-share distribution across a product's known
 * shops. Shares evolve with a deterministic concentration trend + per-shop noise,
 * then normalize to 1 each day so product totals reconcile exactly with shop totals.
 */
export function simulateCompetition(
  shopIds: number[],
  days: number,
  endDate: Date,
  seedKey: string,
  structure: MarketStructure = marketStructureForKey(seedKey),
): CompetitionPoint[] {
  const n = Math.max(1, Math.trunc(days));
  const k = shopIds.length;
  if (k === 0) return [];
  const endMs = endDate.getTime();
  const startMs = endMs - (n - 1) * DAY_MS;
  const rnd = seededRandom(seedKey + ':competition:' + GENERATION_VERSION);

  if (k === 1) {
    return Array.from({ length: n }, (_x, i) => {
      const date = new Date(startMs + i * DAY_MS);
      return { bucketDate: date.toISOString().slice(0, 10), topShopShare: 1, hhi: 1, shopCount: 1, shares: [1] };
    });
  }

  const points: CompetitionPoint[] = [];
  for (let i = 0; i < n; i++) {
    const t = n <= 1 ? 1 : i / (n - 1);
    const noise = (rnd() - 0.5) * 0.08;
    let leaderShare: number;
    if (structure === 'HIGHLY_CONCENTRATED') leaderShare = clamp(0.72 + noise, 0.62, 0.82);
    else if (structure === 'MODERATE') leaderShare = clamp(0.48 + noise, 0.38, 0.58);
    else if (structure === 'FRAGMENTED') leaderShare = clamp(0.30 + noise, 0.22, 0.38);
    else leaderShare = clamp(0.68 - 0.34 * t + noise, 0.28, 0.76); // entrants gradually gain share

    const weights = shopIds.map((id, j) => {
      if (j === 0) return leaderShare;
      if (structure === 'EMERGING_COMPETITORS' && j === shopIds.length - 1) return Math.max(0.04, 0.06 + 0.28 * t + noise / 2);
      return 0.5 + (createHash('sha256').update(`shop:${id}`).digest().readUInt32LE(0) % 1000) / 1000;
    });
    const remainder = weights.slice(1).reduce((a, b) => a + b, 0) || 1;
    const shares = weights.map((w, j) => j === 0 ? leaderShare : round4((1 - leaderShare) * w / remainder));
    // Repair rounding so shares sum to exactly 1 (within Decimal(30,4) precision).
    const shareTotal = shares.reduce((a, b) => a + b, 0);
    if (shares.length > 1) shares[shares.length - 1] = round4((shares.at(-1) ?? 0) + (1 - shareTotal));
    const top = Math.max(...shares);
    const hhi = shares.reduce((sum, s) => sum + s * s, 0);
    const date = new Date(startMs + i * DAY_MS);
    points.push({ bucketDate: date.toISOString().slice(0, 10), topShopShare: round4(top), hhi: round4(hhi), shopCount: k, shares });
  }
  return points;
}

export function affiliateShareForDay(profile: AffiliateProfile, dayIndex: number, days: number, seedKey: string): number {
  const t = days <= 1 ? 1 : dayIndex / (days - 1);
  const rnd = seededRandom(`${seedKey}:affiliate:${dayIndex}:${GENERATION_VERSION}`)();
  const base = profile === 'STRONG_AFFILIATE'
    ? 0.28 + 0.10 * t
    : 0.03 + 0.04 * t;
  return clamp(base + (rnd - 0.5) * (profile === 'STRONG_AFFILIATE' ? 0.08 : 0.03), 0, 0.49);
}

/** Largest-remainder allocation; integer parts sum exactly to total. */
export function allocateInteger(total: number, weights: number[]): number[] {
  const safeTotal = Math.max(0, Math.trunc(total));
  if (!weights.length) return [];
  const positive = weights.map((w) => Math.max(0, w));
  const sum = positive.reduce((a, b) => a + b, 0);
  if (sum <= 0) return positive.map((_w, i) => i === 0 ? safeTotal : 0);
  const raw = positive.map((w) => w / sum * safeTotal);
  const base = raw.map(Math.floor);
  let remainder = safeTotal - base.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let i = 0; remainder > 0; i++, remainder--) {
    const item = order[i % order.length];
    if (item) base[item.i] = (base[item.i] ?? 0) + 1;
  }
  return base;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function metadataFor(profile: SimulationProfile, seedKey: string): { sourceType: string; scenario: Scenario; generationVersion: string; generatedAt: string; seedKey: string; anchorSold: number; anchorPrice: number } {
  return {
    sourceType: 'SIMULATED',
    scenario: profile.scenario,
    generationVersion: GENERATION_VERSION,
    generatedAt: new Date().toISOString(),
    seedKey,
    anchorSold: profile.anchorSold,
    anchorPrice: profile.anchorPrice,
  };
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
