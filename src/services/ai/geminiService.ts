import { env } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';
import { createLogger } from '../../utils/logger.js';
import { randomUUID } from 'node:crypto';
import { REPORT_SECTIONS, type AiReport, type GeminiResult } from './aiAnalysisTypes.js';
import { getAiProvider } from './aiProviderFactory.js';
import type { ProviderUsage } from './aiProvider.js';

const logger = createLogger('ai-provider');
const SYSTEM_INSTRUCTIONS = `You are a TikTok Shop product intelligence analyst for Vietnamese merchants and creators. Write 100% of every human-readable narrative in natural, grammatically correct Vietnamese. Return only valid JSON. Never invent or recalculate supplied numeric facts. Required JSON keys: executiveSummary, dataQuality, ${REPORT_SECTIONS.join(', ')}.`;

export interface GeminiValidationDiagnostic { code:string; path:string; expected:string; actualType?:string; topLevelKeys?:string[]; sectionCount?:number }
export interface GeminiGenerationOptions<T> {
  diagnose?: (value:unknown)=>GeminiValidationDiagnostic|null;
  repairInstructions?: (diagnostic:GeminiValidationDiagnostic)=>string;
  /** 'json' (default) parses+validates a JSON schema with repair; 'text' accepts any non-empty readable content (Markdown/text/JSON) with no schema enforcement. */
  format?: 'json' | 'text';
}
type Totals={inputTokens:number;outputTokens:number;totalTokens:number;observed:boolean};

export async function analyzeWithGemini(data: unknown): Promise<GeminiResult> { return generateWithGemini(data, SYSTEM_INSTRUCTIONS, isReport); }

export async function generateWithGemini<T>(data:unknown,instructions:string,validate:(value:unknown)=>value is T,options:GeminiGenerationOptions<T>={}):Promise<{report:T;inputTokens:number;outputTokens:number;totalTokens:number}> {
 const provider=getAiProvider();const serialized=JSON.stringify(data);
 if(serialized.length>env.gemini.maxInputChars)throw new AppError('Dữ liệu phân tích vượt giới hạn đầu vào.',413,'AI_INPUT_TOO_LARGE');
 const requestId=randomUUID();const totals:Totals={inputTokens:0,outputTokens:0,totalTokens:0,observed:false};
 logger.info('AI provider request bắt đầu',{requestId,provider:provider.name,model:provider.model,payloadChars:serialized.length,maxAttempts:env.gemini.maxAttempts});
 for(let attempt=1;attempt<=env.gemini.maxAttempts;attempt++){
  try{
   const result=await providerAttempt(provider,instructions,serialized,env.gemini.maxOutputTokens,0.2,requestId,attempt,'generation',validate,options);
   addUsage(totals,result.usage);logger.info('AI provider request hoàn tất',{requestId,provider:provider.name,model:provider.model,attempt,inputTokens:totals.inputTokens,outputTokens:totals.outputTokens});
   return {report:result.report,inputTokens:totals.inputTokens,outputTokens:totals.outputTokens,totalTokens:totals.totalTokens};
  }catch(error){
   addUsage(totals,usageFromError(error));
   // Schema repair only for a genuinely parsed-JSON mismatch (not for Markdown/text).
   if(error instanceof AppError&&error.code==='AI_SCHEMA_MISMATCH'&&options.repairInstructions&&attempt===1){
    const diagnostic=readDiagnostic(error.details);if(diagnostic){
     logger.info('AI schema repair bắt đầu',{requestId,provider:provider.name,model:provider.model,attempt,diagnostic});
     try{const repaired=await providerAttempt(provider,instructions+'\n\n'+options.repairInstructions(diagnostic),serialized,env.gemini.maxOutputTokens,0,requestId,attempt,'schema_repair',validate,options);addUsage(totals,repaired.usage);return {report:repaired.report,inputTokens:totals.inputTokens,outputTokens:totals.outputTokens,totalTokens:totals.totalTokens};}
     catch(repairError){addUsage(totals,usageFromError(repairError));throw withTotals(repairError,totals);}
    }
   }
   const retryable=isRetryable(error);logger.warn('AI provider request thất bại',{requestId,provider:provider.name,model:provider.model,attempt,code:error instanceof AppError?error.code:'AI_NETWORK_ERROR',retryable,details:error instanceof AppError?error.details:undefined});
   if(!retryable||attempt>=env.gemini.maxAttempts)throw withTotals(error,totals);
   await new Promise(resolve=>setTimeout(resolve,retryDelay(attempt,retryAfter(error))));
  }
 }
 throw new AppError('AI provider không trả về kết quả.',502,'AI_PROVIDER_ERROR',{providerDispatchStarted:false,providerUsage:totals});
}

export async function generateTextWithGemini(data:unknown,instructions:string,validate:(value:string)=>boolean):Promise<{report:string;inputTokens:number;outputTokens:number;totalTokens:number}> {
 const provider=getAiProvider();const serialized=JSON.stringify(data);
 if(serialized.length>env.gemini.maxInputChars)throw new AppError('Dữ liệu phân tích vượt giới hạn đầu vào.',413,'AI_INPUT_TOO_LARGE');
 const requestId=randomUUID();const totals:Totals={inputTokens:0,outputTokens:0,totalTokens:0,observed:false};
 for(let attempt=1;attempt<=env.gemini.maxAttempts;attempt++){
  try{
   const result=await providerTextAttempt(provider,instructions,serialized,env.gemini.maxOutputTokens,0.2,requestId,attempt);
   addUsage(totals,result.usage);
   if(!validate(result.report))throw new AppError('Báo cáo AI rỗng hoặc không thể hiển thị.',502,'AI_INVALID_RESPONSE',{providerDispatchStarted:true,providerUsage:result.usage,phase:'validation'});
   return {report:result.report,inputTokens:totals.inputTokens,outputTokens:totals.outputTokens,totalTokens:totals.totalTokens};
  }catch(error){
   addUsage(totals,usageFromError(error));
   if(!isRetryable(error)||attempt>=env.gemini.maxAttempts)throw withTotals(error,totals);
   await new Promise(resolve=>setTimeout(resolve,retryDelay(attempt,retryAfter(error))));
  }
 }
 throw new AppError('AI provider không trả về kết quả.',502,'AI_PROVIDER_ERROR',{providerDispatchStarted:false,providerUsage:totals});
}

async function providerAttempt<T>(provider:ReturnType<typeof getAiProvider>,systemPrompt:string,userPayload:string,maxOutputTokens:number,temperature:number,requestId:string,attempt:number,requestKind:'generation'|'schema_repair',validate:(value:unknown)=>value is T,options:GeminiGenerationOptions<T>){
 const controller=new AbortController();const startedAt=Date.now();const timeout=setTimeout(()=>controller.abort(new DOMException('AI request timed out','AbortError')),env.gemini.timeoutMs);
 try{
  const response=await provider.generate({systemPrompt,userPayload,maxOutputTokens,temperature,signal:controller.signal,format:options.format ?? 'json'});
   logger.info('AI provider response metadata',{requestId,provider:provider.name,model:provider.model,attempt,requestKind,durationMs:Date.now()-startedAt,maxOutputTokens, candidateCount:response.candidateCount,partsCount:response.partsCount,visibleContentKind:response.visibleContentKind,visibleContentPresent:!!response.text,textChars:response.text.length,finishReason:response.finishReason,reasoningPresent:response.reasoningPresent,reasoningDetailsCount:response.reasoningDetailsCount,reasoningTokens:response.reasoningTokens,inputTokens:response.usage.inputTokens,outputTokens:response.usage.outputTokens,usagePresent:response.usage.observed});
   if(!response.text){const exhausted=response.finishReason==='length'&&response.reasoningPresent&&response.reasoningTokens!==null;const incomplete=response.finishReason==='length';throw new AppError(exhausted?'AI provider đã dùng hết ngân sách reasoning trước khi trả nội dung cuối cùng.':incomplete?'AI provider dừng trước khi trả nội dung cuối cùng.':'AI provider trả về báo cáo rỗng.',502,exhausted?'AI_REASONING_EXHAUSTED':incomplete?'AI_INCOMPLETE_OUTPUT':'AI_EMPTY_RESPONSE',{providerDispatchStarted:true,providerUsage:response.usage,finishReason:response.finishReason,visibleContentKind:response.visibleContentKind,reasoningPresent:response.reasoningPresent,reasoningDetailsCount:response.reasoningDetailsCount,reasoningTokens:response.reasoningTokens});}
   const report=coerceReport<T>(response.text,validate,options,requestKind);
   return {report,usage:response.usage};
  }catch(error){
   if(error instanceof AppError)throw error;
   if(controller.signal.aborted)throw new AppError('AI provider hết thời gian chờ.',504,'AI_TIMEOUT',{providerDispatchStarted:true,abortReason:'AbortError'});
   throw new AppError('Không thể kết nối AI provider.',502,'AI_NETWORK_ERROR',{providerDispatchStarted:true});
  }finally{clearTimeout(timeout);}
}

/** Strip a leading/trailing markdown code fence (```json / ```markdown / ```md / ```). */
function stripFence(text:string):string { return text.trim().replace(/^```(?:json|markdown|md)?\s*/i,'').replace(/\s*```$/,'').trim(); }

/**
 * Convert a provider's raw visible text into the report type T.
 * - 'text' mode: accept any non-empty readable content (Markdown/plain text/JSON),
 *   never enforce a JSON schema.
 * - 'json' mode: if the content is JSON-shaped, parse and validate; a parsed-but-
 *   schema-violating JSON raises AI_SCHEMA_MISMATCH (eligible for repair), while
 *   non-JSON text still falls through to the text-acceptance path.
 */
function coerceReport<T>(text:string,validate:(value:unknown)=>value is T,options:GeminiGenerationOptions<T>,requestKind:'generation'|'schema_repair'):T{
 const trimmed=text.trim();
 if(!trimmed)throw new AppError('AI provider trả về nội dung rỗng.',502,'AI_INVALID_RESPONSE',{providerDispatchStarted:true,phase:'validation'});
 const fenceStripped=stripFence(text);
 const jsonLike=trimmed.startsWith('{')||trimmed.startsWith('[');
 if(jsonLike){
  try{
   const parsed=JSON.parse(trimmed);
   if(validate(parsed))return parsed;
   if(options.format==='json'){
    const diagnostic=options.diagnose?.(parsed)??{code:'VALIDATION_FAILED',path:'$',expected:'application report contract'};
    throw new AppError('Báo cáo AI thiếu cấu trúc bắt buộc.',502,'AI_SCHEMA_MISMATCH',{providerDispatchStarted:true,phase:'validation',requestKind,diagnostic});
   }
  }catch(error){
   if(error instanceof AppError)throw error;
   /* invalid JSON — fall through to text acceptance */
  }
 }
 // Markdown/plain text path: accept any non-empty readable string.
 if(validate(fenceStripped))return fenceStripped as unknown as T;
 // Still nothing accepted: reject, but keep it as a plain "unusable content" error.
 throw new AppError('AI provider trả về nội dung không thể hiển thị.',502,'AI_INVALID_RESPONSE',{providerDispatchStarted:true,phase:'validation'});
}

async function providerTextAttempt(provider:ReturnType<typeof getAiProvider>,systemPrompt:string,userPayload:string,maxOutputTokens:number,temperature:number,requestId:string,attempt:number){
 const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(new DOMException('AI request timed out','AbortError')),env.gemini.timeoutMs);
 try{
  const response=await provider.generate({systemPrompt,userPayload,maxOutputTokens,temperature,signal:controller.signal,format:'text'});
  if(!response.text)throw new AppError(response.finishReason==='length'?'AI provider dừng trước khi trả nội dung hoàn chỉnh.':'AI provider trả về báo cáo rỗng.',502,response.finishReason==='length'?'AI_INCOMPLETE_OUTPUT':'AI_EMPTY_RESPONSE',{providerDispatchStarted:true,providerUsage:response.usage,finishReason:response.finishReason});
  if(response.finishReason==='length')throw new AppError('AI provider dừng trước khi trả nội dung hoàn chỉnh.',502,'AI_INCOMPLETE_OUTPUT',{providerDispatchStarted:true,providerUsage:response.usage,finishReason:response.finishReason});
  return {report:response.text,usage:response.usage};
 }catch(error){
  if(error instanceof AppError)throw error;
  if(controller.signal.aborted)throw new AppError('AI provider hết thời gian chờ.',504,'AI_TIMEOUT',{providerDispatchStarted:true,abortReason:'AbortError'});
  throw new AppError('Không thể kết nối AI provider.',502,'AI_NETWORK_ERROR',{providerDispatchStarted:true});
 }finally{clearTimeout(timeout);}
}

function addUsage(totals:Totals,usage:ProviderUsage|undefined){if(!usage)return;totals.inputTokens+=usage.inputTokens??0;totals.outputTokens+=usage.outputTokens??0;totals.totalTokens+=usage.totalTokens??(usage.inputTokens??0)+(usage.outputTokens??0);totals.observed=totals.observed||usage.observed;}
function usageFromError(error:unknown):ProviderUsage|undefined {const details=error instanceof AppError&&error.details&&typeof error.details==='object'?error.details as Record<string,unknown>:null;const usage=details?.providerUsage;return usage&&typeof usage==='object'?usage as ProviderUsage:undefined;}
function withTotals(error:unknown,totals:Totals):AppError {if(error instanceof AppError){const details=error.details&&typeof error.details==='object'?error.details:{};return new AppError(error.message,error.statusCode,error.code,{...details,providerUsage:totals});}return new AppError('Không thể kết nối AI provider.',502,'AI_NETWORK_ERROR',{providerDispatchStarted:true,providerUsage:totals});}
function readDiagnostic(value:unknown):GeminiValidationDiagnostic|null {const diagnostic=value&&typeof value==='object'?(value as Record<string,unknown>).diagnostic:null;if(!diagnostic||typeof diagnostic!=='object')return null;const record=diagnostic as Record<string,unknown>;return typeof record.code==='string'&&typeof record.path==='string'&&typeof record.expected==='string'?{code:record.code,path:record.path,expected:record.expected}:null;}
function isRetryable(error:unknown){return error instanceof AppError&&['AI_TIMEOUT','AI_NETWORK_ERROR','AI_RATE_LIMIT','AI_PROVIDER_UNAVAILABLE','AI_PROVIDER_TIMEOUT'].includes(error.code);}
function retryAfter(error:unknown){const details=error instanceof AppError&&error.details&&typeof error.details==='object'?error.details as Record<string,unknown>:null;return typeof details?.retryAfterMs==='number'?details.retryAfterMs:0;}
function retryDelay(attempt:number,retryAfterMs:number){const base=Math.max(retryAfterMs,Math.min(30_000,env.gemini.retryDelayMs*2**Math.max(0,attempt-1)));return Math.min(30_000,base+Math.floor(Math.random()*Math.max(1,Math.min(1_000,base/4))));}
function isReport(value:unknown):value is AiReport {return !!value&&typeof value==='object'&&!Array.isArray(value);}
