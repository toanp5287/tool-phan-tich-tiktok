import { env } from '../../config/env.js';
import type { AiProvider } from './aiProvider.js';
import { providerConfigurationError } from './aiProvider.js';
import { GoogleProvider } from './googleProvider.js';
import { OpenRouterProvider } from './openRouterProvider.js';

export function getAiProvider(): AiProvider {
  const error = providerConfigurationError(); if (error) throw error;
  return env.ai.provider === 'openrouter' ? new OpenRouterProvider() : new GoogleProvider();
}
