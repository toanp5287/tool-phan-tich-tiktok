import { env } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';
import type { AiProvider, ProviderRequest, ProviderResult } from './aiProvider.js';
import { providerModel, usageDetails, usageFromValues } from './aiProvider.js';

export class OpenRouterProvider implements AiProvider {
  readonly name = 'openrouter' as const;
  get model() { return providerModel(); }
  assertConfigured() { if (!env.openrouter.apiKey) throw new AppError('OpenRouter chưa được cấu hình.', 503, 'AI_UNAVAILABLE'); }
  async generate(request: ProviderRequest): Promise<ProviderResult> {
    this.assertConfigured();
    const reasoning = this.model.startsWith('nvidia/nemotron-3.5-super-vl') ? { enabled: false } : undefined;
    const responseFormat = request.format === 'text' ? undefined : { type: 'json_object' };
    const body = JSON.stringify({ model: this.model, messages: [{ role: 'system', content: request.systemPrompt }, { role: 'user', content: request.userPayload }], max_tokens: request.maxOutputTokens, temperature: request.temperature, ...(responseFormat ? { response_format: responseFormat } : {}), ...(reasoning ? { reasoning } : {}) });
    let dispatched = false;
    try {
      dispatched = true;
      const response = await fetch(env.openrouter.baseUrl, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${env.openrouter.apiKey}` }, signal: request.signal, body });
      const raw = await response.text();
      let parsed: any = null;
      try { parsed = raw ? JSON.parse(raw) : null; } catch { throw new AppError('OpenRouter trả về body không phải JSON.', 502, 'AI_INVALID_RESPONSE', { providerDispatchStarted: true, phase: 'body', bodyChars: raw.length }); }
      const usage = usageFromValues(parsed?.usage?.prompt_tokens, parsed?.usage?.completion_tokens, parsed?.usage?.total_tokens);
      if (!response.ok) {
        const details = { providerDispatchStarted: true, providerStatus: response.status, ...usageDetails(usage) };
        const message = `OpenRouter lỗi (${response.status}): ${parsed?.error?.message ?? parsed?.message ?? 'Yêu cầu thất bại'}`;
        if ([400, 401, 403, 404].includes(response.status)) throw new AppError(message, response.status, response.status === 404 ? 'AI_MODEL_NOT_FOUND' : response.status === 400 ? 'AI_INVALID_REQUEST' : 'AI_AUTH_ERROR', { ...details, providerConfirmedPreGeneration: true });
        if (response.status === 429) throw new AppError(message, 429, 'AI_RATE_LIMIT', details);
        if ([500, 502, 503].includes(response.status)) throw new AppError(message, response.status, 'AI_PROVIDER_UNAVAILABLE', details);
        if (response.status === 504) throw new AppError(message, 504, 'AI_PROVIDER_TIMEOUT', details);
        throw new AppError(message, 502, 'AI_PROVIDER_ERROR', details);
      }
      const choice = parsed?.choices?.[0]; const message = choice?.message;
      const rawContent = message?.content;
      const visibleContentKind = contentKind(rawContent);
      const content = extractContent(rawContent);
      const reasoningPresent = typeof message?.reasoning === 'string' && message.reasoning.length > 0;
      const reasoningDetailsCount = Array.isArray(message?.reasoning_details) ? message.reasoning_details.length : 0;
      const reasoningTokens = optionalToken(parsed?.usage?.completion_tokens_details?.reasoning_tokens ?? parsed?.usage?.reasoning_tokens);
      return { text: content, usage, finishReason: choice?.finish_reason ?? null, candidateCount: parsed?.choices?.length ?? 0, partsCount: content ? 1 : 0, visibleContentKind, reasoningPresent, reasoningDetailsCount, reasoningTokens };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('Không thể kết nối OpenRouter.', 502, 'AI_NETWORK_ERROR', { providerDispatchStarted: dispatched });
    }
  }
}
function contentKind(value:unknown):'string'|'array'|'object'|'null'|'undefined'|'other'{if(typeof value==='string')return 'string';if(Array.isArray(value))return 'array';if(value===null)return 'null';if(value===undefined)return 'undefined';if(typeof value==='object')return 'object';return 'other';}
function optionalToken(value:unknown):number|null{return typeof value==='number'&&Number.isFinite(value)&&value>=0?Math.trunc(value):null;}
/** Join string content or array-of-content-parts into a single visible text; ignore non-text parts. */
function extractContent(value:unknown):string{
 if(typeof value==='string')return value.trim();
 if(Array.isArray(value))return value.map(part=>typeof part==='string'?part:part&&typeof part==='object'&&typeof (part as Record<string,unknown>).text==='string'?(part as Record<string,unknown>).text as string:'').join('').trim();
 if(value&&typeof value==='object'){const text=(value as Record<string,unknown>).text;return typeof text==='string'?text.trim():'';}
 return '';
}
