import type { Score } from '../ai/marketIntelligenceTypes.js';

export type OpportunityClassification =
  | 'EMERGING_WINNER'
  | 'POTENTIAL_WINNER'
  | 'ESTABLISHED_WINNER'
  | 'SATURATED_MARKET'
  | 'DECLINING_MARKET'
  | 'INSUFFICIENT_DATA';

export interface ClassificationInput {
  score: number | null;
  confidence: number;
  isInsufficient: boolean;
  growthRate: number | null;
  competitionLevel: 'LOW' | 'MODERATE' | 'HIGH' | 'SATURATED' | 'UNKNOWN';
  topShopShare: number | null;
}

export interface ClassificationResult {
  classification: OpportunityClassification;
  reasons: string[];
  positiveFactors: string[];
  negativeFactors: string[];
}

const COMPETITION_LABEL: Record<string, string> = {
  LOW: 'Cạnh tranh thấp',
  MODERATE: 'Cạnh tranh vừa phải',
  HIGH: 'Cạnh tranh cao',
  SATURATED: 'Bão hòa',
  UNKNOWN: 'Chưa xác định cạnh tranh',
};

/**
 * Opportunity Classification — 6 loại, không dựa một chỉ số đơn lẻ.
 * Order ưu tiên: INSUFFICIENT_DATA → SATURATED → DECLINING → EMERGING → POTENTIAL → ESTABLISHED.
 */
export function classifyOpportunity(input: ClassificationInput): ClassificationResult {
  const reasons: string[] = [];
  const positiveFactors: string[] = [];
  const negativeFactors: string[] = [];

  if (input.isInsufficient || input.score === null) {
    return {
      classification: 'INSUFFICIENT_DATA',
      reasons: ['Chưa đủ dữ liệu cốt lõi để chấm điểm hoặc phân loại.'],
      positiveFactors,
      negativeFactors: ['Thiếu dữ liệu nhu cầu/tăng trưởng/cạnh tranh.'],
    };
  }

  if (input.topShopShare !== null && input.topShopShare >= 0.6 && input.confidence >= 65) {
    return {
      classification: 'SATURATED_MARKET',
      reasons: [`Shop dẫn đầu chiếm ${Math.round(input.topShopShare * 100)}% — mức độ tập trung cao.`],
      positiveFactors: ['Nhu cầu đã được chứng minh.'],
      negativeFactors: ['Cạnh tranh/tập trung cao, khó tham gia.'],
    };
  }

  if (input.growthRate !== null && input.growthRate < -10) {
    return {
      classification: 'DECLINING_MARKET',
      reasons: [`Tăng trưởng âm (${Math.round(input.growthRate)}%), tín hiệu suy giảm.`],
      positiveFactors: [],
      negativeFactors: ['Nhu cầu đang suy giảm.'],
    };
  }

  const growth = input.growthRate ?? 0;
  if (input.score >= 70 && growth > 20 && input.competitionLevel === 'LOW') {
    reasons.push('Tăng trưởng mạnh với cạnh tranh thấp — dấu hiệu ngách mới nổi.');
    positiveFactors.push('Tăng trưởng mạnh', 'Cạnh tranh thấp');
    return { classification: 'EMERGING_WINNER', reasons, positiveFactors, negativeFactors };
  }

  if (input.score >= 55) {
    reasons.push('Điểm cơ hội ở mức có triển vọng, cần theo dõi thêm.');
    positiveFactors.push('Điểm cơ hội khá');
    return { classification: 'POTENTIAL_WINNER', reasons, positiveFactors, negativeFactors };
  }

  reasons.push('Nhu cầu đã hình thành, thị trường ổn định.');
  positiveFactors.push('Nhu cầu ổn định');
  return { classification: 'ESTABLISHED_WINNER', reasons, positiveFactors, negativeFactors };
}

export function competitionLevel(topShopShare: number | null, sellerCount: number | null): ClassificationInput['competitionLevel'] {
  if (topShopShare === null) return sellerCount === 0 ? 'UNKNOWN' : 'UNKNOWN';
  if (topShopShare >= 0.6) return 'SATURATED';
  if (topShopShare >= 0.4) return 'HIGH';
  if (topShopShare >= 0.2) return 'MODERATE';
  return 'LOW';
}

export { COMPETITION_LABEL };
