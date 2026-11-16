import assert from 'node:assert/strict';
import { env } from '../dist/config/env.js';
import { OpenRouterProvider } from '../dist/services/ai/openRouterProvider.js';

const original = { provider: env.ai.provider, model: env.ai.model, key: env.openrouter.apiKey, url: env.openrouter.baseUrl, fetch: globalThis.fetch };
try {
   env.ai.provider = 'openrouter'; env.ai.model = 'nvidia/nemotron-3.5-super-vl:free'; env.openrouter.apiKey = 'test-only-not-a-real-key'; env.openrouter.baseUrl = 'https://openrouter.test/api/v1/chat/completions';
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), options };
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } }), { status: 200 });
  };
  const provider = new OpenRouterProvider();
  const result = await provider.generate({ systemPrompt: 'system', userPayload: 'payload', maxOutputTokens: 100, temperature: 0, signal: new AbortController().signal });
  assert.equal(request.url, env.openrouter.baseUrl);
  assert.equal(request.options.headers.authorization, 'Bearer test-only-not-a-real-key');
  const body = JSON.parse(request.options.body);
   assert.equal(body.model, 'nvidia/nemotron-3.5-super-vl:free'); assert.equal(body.messages[0].role, 'system'); assert.equal(body.messages[1].role, 'user'); assert.equal(body.response_format.type, 'json_object');assert.deepEqual(body.reasoning,{enabled:false});
  assert.equal(result.text, '{"ok":true}'); assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 8, totalTokens: 20, observed: true }); assert.equal(result.visibleContentKind,'string');assert.equal(result.reasoningPresent,false);assert.equal(result.reasoningTokens,null);
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: null, reasoning: 'private chain of thought', reasoning_details: [{ type: 'reasoning.summary' }] } }], usage: { prompt_tokens: 5, completion_tokens: 100, total_tokens: 105, completion_tokens_details: { reasoning_tokens: 90 } } }), { status: 200 });
  const reasoningOnly=await provider.generate({ systemPrompt: 's', userPayload: 'p', maxOutputTokens: 100, temperature: 0, signal: new AbortController().signal });
  assert.equal(reasoningOnly.text,'');assert.equal(reasoningOnly.visibleContentKind,'null');assert.equal(reasoningOnly.reasoningPresent,true);assert.equal(reasoningOnly.reasoningDetailsCount,1);assert.equal(reasoningOnly.reasoningTokens,90);assert.equal(reasoningOnly.finishReason,'length');
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: [{ type: 'text', text: '{"ignored":true}' }], reasoning_details: [{ type: 'reasoning.summary' }, { type: 'reasoning.encrypted' }] } }], usage: { reasoning_tokens: 7 } }), { status: 200 });
  const structuredContent=await provider.generate({ systemPrompt: 's', userPayload: 'p', maxOutputTokens: 100, temperature: 0, signal: new AbortController().signal });
  assert.equal(structuredContent.text,'');assert.equal(structuredContent.visibleContentKind,'array');assert.equal(structuredContent.reasoningPresent,false);assert.equal(structuredContent.reasoningDetailsCount,2);assert.equal(structuredContent.reasoningTokens,7);assert.equal(structuredContent.usage.observed,false);
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'bad request' } }), { status: 400 });
  await assert.rejects(provider.generate({ systemPrompt: 's', userPayload: 'p', maxOutputTokens: 1, temperature: 0, signal: new AbortController().signal }), error => error.code === 'AI_INVALID_REQUEST' && error.details.providerConfirmedPreGeneration === true);
  console.log(JSON.stringify({ result: 'PASS', transport: 'mocked OpenRouter only', realProviderRequests: 0 }));
} finally {
  env.ai.provider = original.provider; env.ai.model = original.model; env.openrouter.apiKey = original.key; env.openrouter.baseUrl = original.url; globalThis.fetch = original.fetch;
}
