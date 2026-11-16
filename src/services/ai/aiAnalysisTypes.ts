export const REPORT_SECTIONS = [
  'productOverview', 'demandAnalysis', 'trendIntelligence', 'priceRevenueAnalysis',
  'videoAnalysis', 'sellerAnalysis', 'competitiveIntelligence', 'affiliateAnalysis',
  'swotRisk', 'forecastStrategy', 'finalConclusion',
] as const;

export type ReportSection = (typeof REPORT_SECTIONS)[number];
export type FindingType = 'FACT' | 'ANALYSIS' | 'FORECAST' | 'RECOMMENDATION';
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT_DATA';
export interface EvidenceItem {
  metric?: string;
  value?: unknown;
  unit?: string;
  source?: string;
  period?: string;
  statement?: string;
}
export interface Finding {
  type?: FindingType;
  statement?: string;
  text?: string;
  evidence?: EvidenceItem[];
  confidence?: Confidence;
  limitations?: string[];
  assumptions?: string[];
}
export interface ReportSectionValue {
  summary?: string;
  description?: string;
  findings?: Finding[];
  [key: string]: unknown;
}
export type AiReport = Record<ReportSection, ReportSectionValue> & {
  executiveSummary: ReportSectionValue;
  dataQuality: ReportSectionValue;
};

export interface GeminiResult {
  report: AiReport;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}
