import type { Score } from '../ai/marketIntelligenceTypes.js';

export type CriterionKey = 'demand' | 'growth' | 'competition' | 'commercial' | 'creator' | 'stability' | 'confidence';

export interface CriterionInput {
  key: CriterionKey;
  label: string;
  weight: number;
  value: number | null;
  formula: string;
}

export interface OpportunityScoreResult {
  scores: Score[];
  total: number | null;
  /** Nhóm được dùng để tính điểm (value != null). */
  scoredCriteria: string[];
  /** Nhóm bị loại vì thiếu dữ liệu (value == null). */
  missing: string[];
  /** Số nhóm cốt lõi bị thiếu (demand/growth/competition). */
  missingCore: number;
  isInsufficient: boolean;
}

const CORE_KEYS = new Set<CriterionKey>(['demand', 'growth', 'competition']);
const clamp = (n: number) => Math.max(0, Math.min(100, n));

/**
 * Opportunity Scoring Engine (7 tiêu chí, thang 100).
 *
 * Nguyên tắc:
 * - Nhóm thiếu dữ liệu (value === null) BỊ LOẠI khỏi trọng số, KHÔNG gán 0.
 * - Tổng điểm = Σ(value × weight) / Σ(weight khả dụng).
 * - Nếu thiếu ≥ 2 nhóm cốt lõi (demand/growth/competition) → INSUFFICIENT_DATA.
 * - `confidence` được tính riêng (không phải opportunity score) bởi caller.
 */
export function scoreOpportunity(inputs: CriterionInput[]): OpportunityScoreResult {
  const scores: Score[] = inputs.map((input) => ({
    criterion: input.label,
    value: input.value === null ? null : Math.round(clamp(input.value)),
    weight: input.weight,
    state: input.value === null ? 'INSUFFICIENT_DATA' : 'AVAILABLE',
    formula: input.formula,
    evidenceIds: [],
  }));

  const available = scores.filter((s) => s.value !== null);
  const missing = scores.filter((s) => s.value === null).map((s) => s.criterion);

  const coreKeysInInput = inputs.filter((i) => CORE_KEYS.has(i.key));
  const missingCore = coreKeysInInput.filter((i) => i.value === null).length;

  const totalWeight = available.reduce((sum, s) => sum + s.weight, 0);
  const total = available.length && totalWeight > 0
    ? Math.round(available.reduce((sum, s) => sum + s.value! * s.weight, 0) / totalWeight)
    : null;

  return {
    scores,
    total,
    scoredCriteria: available.map((s) => s.criterion),
    missing,
    missingCore,
    isInsufficient: total === null || missingCore >= 2,
  };
}

/** Giá trị chuẩn hóa cho Demand/Commercial từ log-scale (0–100). */
export function logScaleScore(value: number | null, base = 10, factor = 20): number | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return null;
  return clamp(Math.log10(value + 1) * factor);
}

/** Growth momentum: clamp(50 + growthRate, 0, 100). */
export function growthScore(growthRate: number | null): number | null {
  if (growthRate === null || !Number.isFinite(growthRate)) return null;
  return clamp(50 + growthRate);
}

/** Competition gap: 100 × (1 − topShopShare); null nếu không có share. */
export function competitionGapScore(topShopShare: number | null): number | null {
  if (topShopShare === null || !Number.isFinite(topShopShare)) return null;
  return clamp(100 * (1 - topShopShare));
}

/** Stability: 100 / (1 + CV) trên các increment; null nếu < 7 điểm. */
export function stabilityScore(increments: number[]): number | null {
  if (increments.length < 7) return null;
  const mean = increments.reduce((a, b) => a + b, 0) / increments.length;
  if (mean <= 0) return null;
  const variance = increments.reduce((sum, v) => sum + (v - mean) ** 2, 0) / increments.length;
  const cv = Math.sqrt(variance) / mean;
  return clamp(100 / (1 + cv));
}

/** Creator opportunity: nhu cầu cao + ít creator → điểm cao. */
export function creatorOpportunityScore(creatorCount: number | null, demandScore: number | null): number | null {
  if (demandScore === null) return null;
  const creators = creatorCount ?? 0;
  // Ít creator nhưng nhu cầu cao = khoảng trống; nhiều creator = cạnh tranh affiliate.
  return clamp(demandScore * (1 - Math.min(1, creators / 20)));
}
