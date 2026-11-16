import {datasetDb as db} from '../../config/datasetDb.js';
import type {Prisma} from '../../../generated/v2/index.js';
import {AppError} from '../../utils/errors.js';
import {isMarketReport} from './marketReportValidator.js';
import type {EvidencePack,MarketReport} from './marketIntelligenceTypes.js';
type StoredReport=Awaited<ReturnType<typeof db.aiAnalysisReport.findFirst>>;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);

export type ReportFormat = 'markdown' | 'text' | 'json';

/**
 * Normalize any provider output into a displayable report string + format.
 * Accepts Markdown, plain text and JSON (with/without optional fields) and never
 * rejects readable content for a missing schema field.
 */
export function normalizeProductContent(value: unknown): { content: string; format: ReportFormat } | null {
  let raw: unknown = value;
  let format: ReportFormat = 'text';

  if (typeof value === 'string') {
    const stripped = value.trim().replace(/^```(?:json|markdown|md)?\s*/i, '').replace(/\s*```$/, '').trim();
    if (stripped.startsWith('{') || stripped.startsWith('[')) {
      try {
        const parsed = JSON.parse(stripped);
        return normalizeProductContent(parsed);
      } catch {
        raw = stripped;
      }
    } else {
      raw = stripped;
    }
  }

  if (object(raw)) {
    // Reject empty object/array early.
    if (Object.keys(raw).length === 0) return null;
    // Extract an obvious report string field if present, else pretty-print the JSON.
    const candidateKeys = ['report', 'content', 'markdown', 'text', 'analysis', 'summary', 'conclusion', 'narrative'];
    for (const key of candidateKeys) {
      const found = (raw as Record<string, unknown>)[key];
      if (typeof found === 'string' && found.trim()) {
        const nested = normalizeProductContent(found);
        return nested ? nested : { content: found.trim(), format: 'markdown' };
      }
    }
    let pretty = '';
    try { pretty = JSON.stringify(raw, null, 2); } catch { return null; }
    if (!pretty.trim()) return null;
    return { content: pretty, format: 'json' };
  }

  if (typeof raw === 'string') {
    const text = raw.trim();
    if (!text || text === '{}' || text === '[]') return null;
    const markdownLike = /^(#|##|###|\*\*|[-*]\s|\||>|`)/m.test(text) || /\n/.test(text);
    return { content: text, format: markdownLike ? 'markdown' : 'text' };
  }

  return null;
}

export function serializeProductReport(row:NonNullable<StoredReport>){
 const envelope=object(row.report)&&row.report.version==='mi-product-storage-v1'?row.report:null;
 if(object(row.report)&&row.report.version===FLEXIBLE_VERSION){return serializeFlexibleProductReport(row);}
 const pack=envelope?.pack as unknown as EvidencePack|undefined;
 const narrative=envelope?.narrative as unknown as MarketReport|undefined;
 const usage=object(envelope?.usage)?envelope.usage:{};
 // Keep old Product report pages readable; legacy JSON is returned untouched.
 const sections:Record<string,unknown>={};
 if(pack&&narrative&&isMarketReport(narrative,pack)){
  const map={executiveSummary:'executiveSummary',dataQuality:'dataLimitations',productOverview:'detailedAnalysis',demandAnalysis:'keyFindings',trendIntelligence:'trendAnalysis',priceRevenueAnalysis:'dataEvidence',videoAnalysis:'detailedAnalysis',sellerAnalysis:'relationshipAnalysis',competitiveIntelligence:'competitiveAnalysis',affiliateAnalysis:'relationshipAnalysis',swotRisk:'riskAssessment',forecastStrategy:'strategicRecommendations',finalConclusion:'conclusion'} as const;
  for(const [oldKey,newKey] of Object.entries(map)){sections[oldKey]={findings:narrative.sections[newKey].findings.map(f=>({...f,evidence:f.evidenceIds.map(id=>{const e=pack.evidence.find(e=>e.id===id)!;return {metric:e.metric,value:e.value,unit:e.currency??e.unit,source:e.source,period:e.observedAt??e.state};})}))};}
 }
 return {...row,id:row.id.toString(),createdAt:row.requestedAt,report:envelope?sections:row.report,dataWindowDays:pack?.request.days??null,dataAsOf:pack?.asOf??null,inputTokens:usage.inputTokens??null,outputTokens:usage.outputTokens??null,totalTokens:usage.totalTokens??null,estimatedCost:usage.estimatedCost??null,evidencePack:pack??null,marketReport:narrative??null,persisted:true};
}
export async function saveProductMarketReport(pack:EvidencePack,narrative:MarketReport,model:string,usage:Record<string,unknown>){
  if(pack.entity.type!=='PRODUCT')return null;
  if(!isMarketReport(narrative,pack))throw new AppError('Không lưu báo cáo không hợp lệ.',502,'AI_INVALID_RESPONSE');
  const report={version:'mi-product-storage-v1',pack,narrative,usage};
  const productId=Number(pack.entity.id);
  const saved=await db.$transaction(async tx=>{
    await tx.$queryRaw`WITH locked AS MATERIALIZED (SELECT pg_advisory_xact_lock(${productId}::bigint)) SELECT 1::integer AS acquired FROM locked`;
   const rows=await tx.aiAnalysisReport.findMany({where:{productId,status:'COMPLETED',dataQuality:{path:['fingerprint'],equals:pack.fingerprint}},orderBy:{id:'desc'},take:1});
   const existing=rows[0];
   if(existing&&object(existing.report)&&existing.report.version==='mi-product-storage-v1'&&isMarketReport(existing.report.narrative,pack))return existing;
   return tx.aiAnalysisReport.create({data:{productId,status:'COMPLETED',model,requestedAt:new Date(),completedAt:new Date(),report:report as unknown as Prisma.InputJsonValue,dataQuality:{fingerprint:pack.fingerprint,evidenceVersion:pack.version,reportVersion:narrative.version} as Prisma.InputJsonValue}});
  });
  return serializeProductReport(saved);
}
export async function cachedProductMarketReport(pack:EvidencePack){
 if(pack.entity.type!=='PRODUCT'||pack.request.compareIds.length)return null;
 const rows=await db.aiAnalysisReport.findMany({where:{productId:Number(pack.entity.id),status:'COMPLETED',dataQuality:{path:['fingerprint'],equals:pack.fingerprint}},orderBy:{id:'desc'},take:1});
 const row=rows[0];if(!row||!object(row.report))return null;
 const envelope=row.report;
 if(envelope.version!=='mi-product-storage-v1'||!isMarketReport(envelope.narrative,pack))return null;
 return {row:serializeProductReport(row),report:envelope.narrative};
}

/** Storage envelope for flexible (Markdown/text/JSON) product reports. */
const FLEXIBLE_VERSION = 'mi-product-flexible-v1';

export interface FlexibleProductReport {
  version: typeof FLEXIBLE_VERSION;
  format: ReportFormat;
  content: string;
  usage: Record<string, unknown>;
}

export function serializeFlexibleProductReport(row: NonNullable<StoredReport>): Record<string, unknown> {
  const envelope = object(row.report) && row.report.version === FLEXIBLE_VERSION ? row.report as unknown as FlexibleProductReport : null;
  const usage = envelope && object(envelope.usage) ? envelope.usage : {};
  return {
    ...row,
    id: row.id.toString(),
    createdAt: row.requestedAt,
    report: envelope ? envelope.content : null,
    format: envelope ? envelope.format : null,
    dataWindowDays: envelope ? (object(envelope) ? (envelope as unknown as Record<string, unknown>).dataWindowDays ?? null : null) : null,
    dataAsOf: envelope ? (object(envelope) ? (envelope as unknown as Record<string, unknown>).dataAsOf ?? null : null) : null,
    inputTokens: usage.inputTokens ?? null,
    outputTokens: usage.outputTokens ?? null,
    totalTokens: usage.totalTokens ?? null,
    estimatedCost: usage.estimatedCost ?? null,
    persisted: true,
  };
}

export async function saveProductFlexibleReport(pack: EvidencePack, content: string, format: ReportFormat, model: string, usage: Record<string, unknown>) {
  if (pack.entity.type !== 'PRODUCT') return null;
  if (!content || !content.trim()) throw new AppError('Không lưu báo cáo rỗng.', 502, 'AI_INVALID_RESPONSE');
  const productId = Number(pack.entity.id);
  const envelope = { version: FLEXIBLE_VERSION, format, content, usage, dataWindowDays: pack.request.days, dataAsOf: pack.asOf };
  const saved = await db.$transaction(async tx => {
    await tx.$queryRaw`WITH locked AS MATERIALIZED (SELECT pg_advisory_xact_lock(${productId}::bigint)) SELECT 1::integer AS acquired FROM locked`;
    const rows = await tx.aiAnalysisReport.findMany({ where: { productId, status: 'COMPLETED', dataQuality: { path: ['fingerprint'], equals: pack.fingerprint } }, orderBy: { id: 'desc' }, take: 1 });
    const existing = rows[0];
    if (existing && object(existing.report) && existing.report.version === FLEXIBLE_VERSION) return existing;
    return tx.aiAnalysisReport.create({ data: { productId, status: 'COMPLETED', model, requestedAt: new Date(), completedAt: new Date(), report: envelope as unknown as Prisma.InputJsonValue, dataQuality: { fingerprint: pack.fingerprint, evidenceVersion: pack.version, reportVersion: FLEXIBLE_VERSION } as Prisma.InputJsonValue } });
  });
  return serializeFlexibleProductReport(saved);
}

export async function cachedProductFlexibleReport(pack: EvidencePack) {
  if (pack.entity.type !== 'PRODUCT' || pack.request.compareIds.length) return null;
  const rows = await db.aiAnalysisReport.findMany({ where: { productId: Number(pack.entity.id), status: 'COMPLETED', dataQuality: { path: ['fingerprint'], equals: pack.fingerprint } }, orderBy: { id: 'desc' }, take: 1 });
  const row = rows[0];
  if (!row || !object(row.report) || row.report.version !== FLEXIBLE_VERSION) return null;
  const envelope = row.report as unknown as FlexibleProductReport;
  if (typeof envelope.content !== 'string' || !envelope.content.trim()) return null;
  return { id: row.id.toString(), status: 'COMPLETED', persisted: true, report: envelope.content, format: envelope.format, model: row.model };
}
