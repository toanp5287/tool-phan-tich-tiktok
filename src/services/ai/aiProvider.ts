import { env } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';

export interface ProviderUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  observed: boolean;
}

export interface ProviderResult {
  text: string;
  usage: ProviderUsage;
  finishReason: string | null;
  candidateCount: number;
  partsCount: number;
  visibleContentKind: 'string' | 'array' | 'object' | 'null' | 'undefined' | 'other';
  reasoningPresent: boolean;
  reasoningDetailsCount: number;
  reasoningTokens: number | null;
}

export interface ProviderRequest {
  systemPrompt: string;
  userPayload: string;
  maxOutputTokens: number;
  temperature: number;
  signal: AbortSignal;
  /** 'json' (default) forces a JSON response format; 'text' leaves the model free to emit Markdown/plain text. */
  format?: 'json' | 'text';
}

export interface AiProvider {
  readonly name: 'google' | 'openrouter';
  readonly model: string;
  assertConfigured(): void;
  generate(request: ProviderRequest): Promise<ProviderResult>;
}

export function providerModel(): string { return env.ai.model; }

export function providerConfigurationError(): AppError | null {
  if (!['google', 'openrouter'].includes(env.ai.provider)) return new AppError('AI_PROVIDER không hợp lệ.', 500, 'AI_PROVIDER_CONFIG');
  if (env.ai.provider === 'google' && (!env.gemini.enabled || !env.gemini.apiKey)) return new AppError('Google AI chưa được cấu hình.', 503, 'AI_UNAVAILABLE');
  if (env.ai.provider === 'openrouter' && !env.openrouter.apiKey) return new AppError('OpenRouter chưa được cấu hình.', 503, 'AI_UNAVAILABLE');
  return null;
}

export function usageFromValues(input: unknown, output: unknown, total: unknown): ProviderUsage {
  const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null;
  const inputTokens = number(input); const outputTokens = number(output); const totalTokens = number(total);
  return { inputTokens, outputTokens, totalTokens, observed: inputTokens !== null || outputTokens !== null || totalTokens !== null };
}

export function usageDetails(usage: ProviderUsage) { return { providerUsage: usage }; }
