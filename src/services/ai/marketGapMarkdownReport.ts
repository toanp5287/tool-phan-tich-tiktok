import {AppError} from '../../utils/errors.js';
import type {EvidencePack,FlexibleMarketGapReport} from './marketIntelligenceTypes.js';

const MAX_CHARS=60_000;
export function normalizeMarketGapMarkdown(value:unknown):string|null {
 if(typeof value!=='string')return null;
 const text=value.trim().replace(/^```(?:markdown|md)?\s*/i,'').replace(/\s*```$/,'').trim();
 if(!text||text.length>MAX_CHARS||text==='{}'||text==='[]')return null;
 return text;
}
export function createMarketGapMarkdownReport(value:unknown,pack:EvidencePack):FlexibleMarketGapReport {
 const content=normalizeMarketGapMarkdown(value);
 if(!content)throw new AppError('AI provider trả về báo cáo Markdown rỗng hoặc không đọc được.',502,'AI_INVALID_RESPONSE');
 return {version:'market-gap-markdown-v1',format:'markdown',content,limitations:[...new Set([...pack.limitations,...pack.missing])].slice(0,20)};
}
export function isFlexibleMarketGapReport(value:unknown):value is FlexibleMarketGapReport {
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const report=value as Record<string,unknown>;
 return report.version==='market-gap-markdown-v1'&&report.format==='markdown'&&normalizeMarketGapMarkdown(report.content)!==null&&Array.isArray(report.limitations)&&report.limitations.every(item=>typeof item==='string');
}
