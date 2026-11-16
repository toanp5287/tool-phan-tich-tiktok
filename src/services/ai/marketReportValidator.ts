import { SECTIONS, type EvidencePack, type MarketReport } from './marketIntelligenceTypes.js';
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export interface MarketReportDiagnostic { code:string; path:string; expected:string; actualType?:string; topLevelKeys?:string[]; sectionCount?:number }
export function normalizeMarketReportShape(value:unknown):unknown {
 if(!object(value)||!object(value.sections))return value;
 const sections=value.sections as Record<string,unknown>;
 for(const key of SECTIONS){if(Array.isArray(sections[key]))sections[key]={findings:sections[key]};}
 return value;
}
export function isMarketReport(value:unknown,pack:EvidencePack):value is MarketReport {
 normalizeMarketReportShape(value);
  return diagnoseMarketReport(value,pack)===null;
}
export function diagnoseMarketReport(value:unknown,pack:EvidencePack):MarketReportDiagnostic|null {
 if(!object(value))return {code:'INVALID_ROOT',path:'$',expected:'object',actualType:typeOf(value)};
 const topLevelKeys=Object.keys(value).sort();
 if(value.version!=='mi-report-v1')return {code:'INVALID_VERSION',path:'version',expected:'mi-report-v1',actualType:typeOf(value.version),topLevelKeys};
 if(!object(value.sections))return {code:'INVALID_SECTIONS',path:'sections',expected:'object',actualType:typeOf(value.sections),topLevelKeys};
 const extraTopLevel=topLevelKeys.find(k=>!['version','sections','chartIds','opportunityIds'].includes(k));
 if(extraTopLevel)return {code:'EXTRA_TOP_LEVEL_KEY',path:extraTopLevel,expected:'no extra top-level keys',topLevelKeys};
 const evidence=new Set(pack.evidence.map(e=>e.id)),charts=new Set(pack.charts.map(c=>c.id)),candidates=new Set(pack.candidates.map(c=>c.id));
 const refs=(v:unknown,allowed:Set<string>)=>Array.isArray(v)&&v.length<=30&&v.every(id=>typeof id==='string'&&allowed.has(id));
 if(!refs(value.chartIds,charts))return {code:'INVALID_CHART_IDS',path:'chartIds',expected:'array of allowed chart IDs',actualType:typeOf(value.chartIds),topLevelKeys};
 if(!refs(value.opportunityIds,candidates))return {code:'INVALID_OPPORTUNITY_IDS',path:'opportunityIds',expected:'array of allowed candidate IDs',actualType:typeOf(value.opportunityIds),topLevelKeys};
 const sections=value.sections as Record<string,unknown>;const sectionKeys=Object.keys(sections);
 if(sectionKeys.length!==SECTIONS.length)return {code:'INVALID_SECTION_COUNT',path:'sections',expected:`exactly ${SECTIONS.length} sections`,sectionCount:sectionKeys.length,topLevelKeys};
 for(const key of SECTIONS){const section=sections[key];if(!object(section))return {code:'INVALID_SECTION',path:`sections.${key}`,expected:'{findings:[]}',actualType:typeOf(section),topLevelKeys,sectionCount:sectionKeys.length};
  const extraSectionKey=Object.keys(section).find(k=>k!=='findings');if(extraSectionKey)return {code:'EXTRA_SECTION_KEY',path:`sections.${key}.${extraSectionKey}`,expected:'only findings',topLevelKeys,sectionCount:sectionKeys.length};
  if(!Array.isArray(section.findings))return {code:'INVALID_FINDINGS',path:`sections.${key}.findings`,expected:'array',actualType:typeOf(section.findings),topLevelKeys,sectionCount:sectionKeys.length};
  if(section.findings.length>8)return {code:'TOO_MANY_FINDINGS',path:`sections.${key}.findings`,expected:'at most 8 findings',topLevelKeys,sectionCount:sectionKeys.length};
  if(key==='executiveSummary'&&section.findings.length===0)return {code:'EMPTY_EXECUTIVE_SUMMARY',path:`sections.${key}.findings`,expected:'at least 1 finding',topLevelKeys,sectionCount:sectionKeys.length};
  for(let index=0;index<section.findings.length;index++){const f=section.findings[index];const path=`sections.${key}.findings[${index}]`;if(!object(f))return {code:'INVALID_FINDING',path,expected:'object',actualType:typeOf(f),topLevelKeys,sectionCount:sectionKeys.length};
   const extraFindingKey=Object.keys(f).find(k=>!['type','statement','evidenceIds','confidence','limitations','assumptions'].includes(k));if(extraFindingKey)return {code:'EXTRA_FINDING_KEY',path:`${path}.${extraFindingKey}`,expected:'only allowed finding keys',topLevelKeys,sectionCount:sectionKeys.length};
   const prose=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=2400&&!/[0-9٠-٩۰-۹]/u.test(v);
   if(!['FACT','ANALYSIS','FORECAST','RECOMMENDATION'].includes(String(f.type)))return {code:'INVALID_FINDING_TYPE',path:`${path}.type`,expected:'FACT|ANALYSIS|FORECAST|RECOMMENDATION',actualType:typeOf(f.type),topLevelKeys,sectionCount:sectionKeys.length};
   if(!prose(f.statement))return {code:'INVALID_STATEMENT',path:`${path}.statement`,expected:'non-empty Vietnamese prose without digits',actualType:typeOf(f.statement),topLevelKeys,sectionCount:sectionKeys.length};
   if(!refs(f.evidenceIds,evidence))return {code:'INVALID_EVIDENCE_IDS',path:`${path}.evidenceIds`,expected:'array of allowed evidence IDs',actualType:typeOf(f.evidenceIds),topLevelKeys,sectionCount:sectionKeys.length};
   if(!['HIGH','MEDIUM','LOW','INSUFFICIENT_DATA'].includes(String(f.confidence)))return {code:'INVALID_CONFIDENCE',path:`${path}.confidence`,expected:'HIGH|MEDIUM|LOW|INSUFFICIENT_DATA',actualType:typeOf(f.confidence),topLevelKeys,sectionCount:sectionKeys.length};
   if(!Array.isArray(f.limitations)||f.limitations.length>8||!f.limitations.every(prose))return {code:'INVALID_LIMITATIONS',path:`${path}.limitations`,expected:'array of prose strings',actualType:typeOf(f.limitations),topLevelKeys,sectionCount:sectionKeys.length};
   if(f.assumptions!==undefined&&(!Array.isArray(f.assumptions)||f.assumptions.length>8||!f.assumptions.every(prose)))return {code:'INVALID_ASSUMPTIONS',path:`${path}.assumptions`,expected:'array of prose strings',actualType:typeOf(f.assumptions),topLevelKeys,sectionCount:sectionKeys.length};
   if(f.type==='FORECAST'&&(!Array.isArray(f.assumptions)||!f.assumptions.length))return {code:'FORECAST_MISSING_ASSUMPTIONS',path:`${path}.assumptions`,expected:'non-empty array for FORECAST',topLevelKeys,sectionCount:sectionKeys.length};
   if(!(f.evidenceIds as string[]).length&&f.confidence!=='INSUFFICIENT_DATA')return {code:'UNSUPPORTED_CONFIDENCE',path:`${path}.confidence`,expected:'INSUFFICIENT_DATA when evidenceIds is empty',topLevelKeys,sectionCount:sectionKeys.length};
   const cited=pack.evidence.filter(e=>(f.evidenceIds as string[]).includes(e.id));
   if(cited.some(e=>e.dataKind==='SIMULATED'))return {code:'SIMULATED_EVIDENCE',path:`${path}.evidenceIds`,expected:'no simulated evidence',topLevelKeys,sectionCount:sectionKeys.length};
   if(f.confidence==='HIGH'&&(!cited.length||cited.some(e=>e.dataKind!=='VERIFIED'||e.state!=='OK')||pack.stale))return {code:'UNSUPPORTED_HIGH_CONFIDENCE',path:`${path}.confidence`,expected:'verified, OK, non-stale cited evidence',topLevelKeys,sectionCount:sectionKeys.length};
  }
 }
 return null;
}
function typeOf(value:unknown){return Array.isArray(value)?'array':value===null?'null':typeof value;}
