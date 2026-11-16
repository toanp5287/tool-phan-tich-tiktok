import type { DataKind } from '../analytics.js';
export const ENTITY_TYPES = ['MARKET','SHOP','PRODUCT','CREATOR','VIDEO','CATEGORY'] as const;
export const MODULES = ['MARKET_OVERVIEW','ENTITY_DEEP_ANALYSIS','RELATIONSHIP_INTELLIGENCE','OPPORTUNITY_DISCOVERY','COMPETITIVE_INTELLIGENCE','STRATEGIC_RECOMMENDATION'] as const;
export const MODES = ['QUICK','DEEP','MARKET_RESEARCH','OPPORTUNITY','COMPARISON'] as const;
export const SECTIONS = ['executiveSummary','keyFindings','detailedAnalysis','dataEvidence','trendAnalysis','competitiveAnalysis','relationshipAnalysis','opportunityDiscovery','riskAssessment','strategicRecommendations','dataLimitations','conclusion'] as const;
export type EntityType = typeof ENTITY_TYPES[number];
export type State = 'OK'|'NO_DATA'|'INSUFFICIENT_HISTORY'|'SINGLE_POINT'|'NO_TIMESTAMP'|'NOT_SUPPORTED'|'STALE_DATA'|'AVAILABLE'|'INSUFFICIENT_DATA'|'NOT_APPLICABLE';
export interface AnalysisRequest { entityType:EntityType; entityId:string; module:typeof MODULES[number]; mode:typeof MODES[number]; audience:'SELLER'|'AFFILIATE'|'MCN'; days:number; compareIds:string[]; force:boolean }
export type Execution = 'LOCAL'|'MOCK';
export interface LocalAnalysis { execution:Execution; status:'LOCAL_COMPLETE'|'MOCK_COMPLETE'; providerCalled:false; persisted:false; usage:{providerRequests:0;inputTokens:0;outputTokens:0;billable:false}; pack:EvidencePack; report:MarketReport }
export interface Evidence { id:string; entityId:string; entityType:EntityType; metric:string; value:number|null; unit:string; currency:string|null; dataKind:DataKind; state:State; observedAt:string|null; source:string|null; usageRestriction:string; recordIds:string[]; fileHashes:string[]; formula:string|null; inputIds:string[]; limitations:string[] }
export interface HistoryPoint {date:string; value:number|null; evidenceId:string}
export interface ChartSpec {id:string; type:'line'|'bar'|'doughnut'|'relationship'; title:string; unit:string; period:string; dataKind:DataKind; state:State; labels:string[]; values:(number|null)[]; evidenceIds:string[]; nodes?:{id:string;label:string}[]; edges?:{from:string;to:string;evidenceId:string}[]}
export interface Relation {id:string; from:string; to:string; type:string; status:string; evidenceIds:string[]; derived:boolean}
export interface Score {criterion:string; value:number|null; weight:number; state:State; formula:string; evidenceIds:string[]}
export interface Candidate {id:string; type:'PRODUCT'|'NICHE'|'SHOP'|'CREATOR'|'CONTENT'; entityKey:string; title:string; priority:'HIGH'|'MEDIUM'|'LOW'; score:number|null; confidence:number; evidenceIds:string[]; limitations:string[]; nextAction:string}
export interface EvidencePack {version:'mi-evidence-v1'; scoringVersion:string; reportVersion:'mi-report-v1'; fingerprint:string; request:Omit<AnalysisRequest,'force'>; entity:{id:string;type:EntityType;name:string}; scope:string; asOf:string|null; preparedAt:string; stale:boolean; evidence:Evidence[]; history:Record<string,HistoryPoint[]>; relations:Relation[]; charts:ChartSpec[]; scores:Score[]; opportunityScore:number|null; evidenceConfidence:number; candidates:Candidate[]; missing:string[]; limitations:string[]; sourcePolicy:{canSendToProvider:boolean;blockedSources:string[]}; sample:{selected:number;available:number;truncated:boolean}; }
export interface Finding {type:'FACT'|'ANALYSIS'|'FORECAST'|'RECOMMENDATION'; statement:string; evidenceIds:string[]; confidence:'HIGH'|'MEDIUM'|'LOW'|'INSUFFICIENT_DATA'; limitations:string[]; assumptions?:string[]}
export interface MarketReport {version:'mi-report-v1'; sections:Record<typeof SECTIONS[number],{findings:Finding[]}>; chartIds:string[]; opportunityIds:string[]}
export interface FlexibleMarketGapReport {version:'market-gap-markdown-v1';format:'markdown';content:string;limitations:string[]}
export type MarketGapMode = 'QUICK'|'DEEP';
export type MarketGapClassification = 'SUPPORTED_GAP'|'RESEARCH_LEAD'|'INSUFFICIENT_DATA';
export type NicheStatus = 'HIGH_POTENTIAL'|'POSITIVE_SIGNAL'|'HIGH_COMPETITION'|'WATCH'|'INSUFFICIENT_DATA';
export type MarketGapEmptyReason = 'NO_PRODUCTS'|'NO_REQUESTED_CURRENCY_PRODUCTS'|'NO_SALES_DATA'|'NO_RECENT_HISTORY'|'NO_ELIGIBLE_NICHES';
export type MarketGapMetricState = 'AVAILABLE'|'INSUFFICIENT_DATA'|'INSUFFICIENT_HISTORY'|'NOT_APPLICABLE';
export type MarketGapAnalysisLevel = 'PRELIMINARY'|'EXTENDED'|'FULL';
export type MarketGapScoreKind = 'PRELIMINARY'|'FULL';
export interface MarketGapAnalysisRequest { market:'VN'; categoryId:number; subCategoryId?:number; currency:string; days:7|30|90; mode:MarketGapMode; force:boolean }
export interface MarketGapConfidencePart { criterion:string; points:number; maxPoints:number; state:State; formula:string; evidenceIds:string[] }

export interface MarketGapDemand {
  estimatedSalesValue:number|null;
  currentPeriodSalesIncrement:number|null;
  previousPeriodSalesIncrement:number|null;
  growthRate:number|null;
  activeProductCount:number|null;
  validProductCount:number;
  productCoverage:number|null;
}

export interface MarketGapCompetition {
  observedVerifiedActiveShopCount:number|null;
  observedShopDensity:number|null;
  linkedProductCoverage:number|null;
  topShopValueShare:number|null;
}

export interface MarketGapMetric {
  value:number|null;
  state:MarketGapMetricState;
  reason:string|null;
  evidenceIds:string[];
}

export interface NicheTopProduct { id:number; title:string; imageUrl:string|null; price:number|null; soldCount:number|null; estimatedSalesValue:number|null }
export interface NicheTopShop { id:number; name:string; productCount:number; estimatedSalesValue:number|null }

export interface MarketGapNiche {
  key:string;
  subCategory:{id:number;name:string;sourceName:string}|null;
  status:NicheStatus;
  statusReasons:string[];
  marketDemand:MarketGapDemand;
  marketCompetition:MarketGapCompetition;
  analysisLevel:MarketGapAnalysisLevel;
  productCount:number;
  metrics:Record<'demand'|'estimatedSalesValue'|'growth'|'competition'|'stability'|'productCoverage',MarketGapMetric>;
  opportunityScore:number|null;
  opportunityScoreKind:MarketGapScoreKind|null;
  scoredCriteria:string[];
  evidenceConfidence:number;
  confidenceBreakdown:MarketGapConfidencePart[];
  scores:Score[];
  missingRequiredMetrics:string[];
  limitations:string[];
}

export interface MarketGapNicheDetail extends MarketGapNiche {
  history:ChartSpec[];
  topProducts:NicheTopProduct[];
  topShops:NicheTopShop[];
  strengths:string[];
  weaknesses:string[];
  risks:string[];
  evidence:Evidence[];
  asOf:string|null;
  stale:boolean;
}

export interface MarketGapResult {
  version:'market-gap-v1';
  scoringVersion:string;
  request:Omit<MarketGapAnalysisRequest,'force'>;
  scope:{market:'VN';category:{id:number;name:string;sourceName:string};subCategory:{id:number;name:string;sourceName:string}|null;currency:string;days:number};
  asOf:string|null;
  stale:boolean;
  niches:MarketGapNiche[];
  nicheCount:number;
  diagnostics:{emptyReason:MarketGapEmptyReason|null;message:string|null;cacheEligible:boolean};
  aiEligibility:{eligible:boolean;reason:string|null;minimumConfidence:number};
  evidencePack:EvidencePack;
}
