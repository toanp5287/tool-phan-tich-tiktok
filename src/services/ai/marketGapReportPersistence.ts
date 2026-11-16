import type { Prisma } from '../../../generated/v2/index.js';
import { datasetDb as db } from '../../config/datasetDb.js';
import type { EvidencePack, FlexibleMarketGapReport } from './marketIntelligenceTypes.js';
import { isFlexibleMarketGapReport } from './marketGapMarkdownReport.js';

export async function findCompletedMarketGapReport(analysisId: bigint, nicheKey: string, fingerprint: string) {
  return db.marketGapAiReport.findFirst({ where: { marketGapAnalysisId: analysisId, nicheKey, evidenceFingerprint: fingerprint, status: 'COMPLETED' }, orderBy: { id: 'desc' } });
}

export async function saveMarketGapReport(input: { analysisId: bigint; nicheKey: string; provider: string; model: string; pack: EvidencePack; report: FlexibleMarketGapReport; usage: { inputTokens: number; outputTokens: number; totalTokens: number; estimatedCost: number; reasoningTokens?: number | null } }) {
  if (!isFlexibleMarketGapReport(input.report)) throw new Error('Refuse to persist an invalid Market Gap Markdown report.');
  const row = await db.marketGapAiReport.create({ data: {
    marketGapAnalysisId: input.analysisId,
    nicheKey: input.nicheKey,
    status: 'COMPLETED',
    provider: input.provider,
    model: input.model,
    report: input.report as unknown as Prisma.InputJsonValue,
    evidenceFingerprint: input.pack.fingerprint,
    scoringVersion: input.pack.scoringVersion,
    completedAt: new Date(),
    inputTokens: input.usage.inputTokens,
    outputTokens: input.usage.outputTokens,
    totalTokens: input.usage.totalTokens,
    reasoningTokens: input.usage.reasoningTokens ?? null,
    estimatedCost: input.usage.estimatedCost,
  } });
  return serializeMarketGapReport(row);
}

export function serializeMarketGapReport(row: { id: bigint; marketGapAnalysisId: bigint; nicheKey: string; status: string; provider: string; model: string; report: unknown; evidenceFingerprint: string; scoringVersion: string; requestedAt: Date; completedAt: Date | null; inputTokens: number | null; outputTokens: number | null; reasoningTokens: number | null; totalTokens: number | null; estimatedCost: unknown }) {
  return { ...row, id: row.id.toString(), analysisId: row.marketGapAnalysisId.toString(), report: row.report, requestedAt: row.requestedAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null };
}

export async function listMarketGapReports(analysisId: bigint, nicheKey: string) {
  const rows = await db.marketGapAiReport.findMany({ where: { marketGapAnalysisId: analysisId, nicheKey }, orderBy: { id: 'desc' }, take: 20 });
  return rows.map(serializeMarketGapReport);
}

export async function getMarketGapReport(id: bigint) {
  const row = await db.marketGapAiReport.findUnique({ where: { id } });
  return row ? serializeMarketGapReport(row) : null;
}
