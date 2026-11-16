import { env } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';
import type { AiProvider, ProviderRequest, ProviderResult } from './aiProvider.js';
import { providerModel, usageDetails, usageFromValues } from './aiProvider.js';

export class GoogleProvider implements AiProvider {
  readonly name = 'google' as const;
  get model() { return providerModel(); }
  assertConfigured() { if (!env.gemini.enabled || !env.gemini.apiKey) throw new AppError('Google AI chưa được cấu hình.', 503, 'AI_UNAVAILABLE'); }
  async generate(request: ProviderRequest): Promise<ProviderResult> {
    this.assertConfigured();
    const body = JSON.stringify({ systemInstruction: { parts: [{ text: request.systemPrompt }] }, contents: [{ role: 'user', parts: [{ text: request.userPayload }] }], generationConfig: { responseMimeType: 'application/json', maxOutputTokens: request.maxOutputTokens, temperature: request.temperature } });
    let dispatched = false;
    try {
      dispatched = true;
      const response = await fetch(`${env.gemini.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(env.gemini.apiKey)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: request.signal, body });
      const raw = await response.text();
      let parsed: any = null;
      try { parsed = raw ? JSON.parse(raw) : null; } catch { throw new AppError('Google AI trả về body không phải JSON.', 502, 'AI_INVALID_RESPONSE', { providerDispatchStarted: true, phase: 'body', bodyChars: raw.length }); }
      const usage = usageFromValues(parsed?.usageMetadata?.promptTokenCount, parsed?.usageMetadata?.candidatesTokenCount, parsed?.usageMetadata?.totalTokenCount);
      if (!response.ok) {
        const details = { providerDispatchStarted: true, providerStatus: response.status, ...usageDetails(usage) };
        const message = `Google AI lỗi (${response.status}): ${parsed?.error?.message ?? 'Yêu cầu thất bại'}`;
        if ([400, 401, 403, 404].includes(response.status)) throw new AppError(message, response.status, response.status === 404 ? 'AI_MODEL_NOT_FOUND' : response.status === 400 ? 'AI_INVALID_REQUEST' : 'AI_AUTH_ERROR', { ...details, providerConfirmedPreGeneration: true });
        if (response.status === 429) throw new AppError(message, 429, 'AI_RATE_LIMIT', details);
        if ([500, 502, 503].includes(response.status)) throw new AppError(message, response.status, 'AI_PROVIDER_UNAVAILABLE', details);
        if (response.status === 504) throw new AppError(message, 504, 'AI_PROVIDER_TIMEOUT', details);
        throw new AppError(message, 502, 'AI_PROVIDER_ERROR', details);
      }
      const candidate = parsed?.candidates?.[0]; const parts = candidate?.content?.parts ?? []; const text = parts.map((part: { text?: string }) => part.text ?? '').join('').trim();
      return { text, usage, finishReason: candidate?.finishReason ?? null, candidateCount: parsed?.candidates?.length ?? 0, partsCount: parts.length, visibleContentKind: text ? 'string' : 'undefined', reasoningPresent: false, reasoningDetailsCount: 0, reasoningTokens: null };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('Không thể kết nối Google AI.', 502, 'AI_NETWORK_ERROR', { providerDispatchStarted: dispatched });
    }
  }
}
