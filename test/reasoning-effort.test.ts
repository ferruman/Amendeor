import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configSchema, profileSchema } from '../src/config.ts';
import { OpenAIProvider } from '../src/provider/openai.ts';
import { AnthropicProvider } from '../src/provider/anthropic.ts';
import { Gateway } from '../src/provider/gateway.ts';
import { loadPack } from '../src/lang/pack.ts';
import { ProviderError, type CompletionRequest, type Provider } from '../src/provider/types.ts';

test('profile reasoning effort validates the OpenRouter enum and remains optional', () => {
  for (const reasoning_effort of ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']) assert.equal(profileSchema.parse({ provider: 'p', model: 'm', reasoning_effort }).reasoning_effort, reasoning_effort);
  assert.equal(profileSchema.parse({ provider: 'p', model: 'm' }).reasoning_effort, undefined);
  assert.throws(() => profileSchema.parse({ provider: 'p', model: 'm', reasoning_effort: 'ultra' }));
});

test('OpenRouter serializes explicit effort only when reasoning is enabled; native Anthropic stays unchanged', async () => {
  const original = globalThis.fetch; const sent: any[] = [];
  globalThis.fetch = (async (_url, init) => {
    sent.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"preserved":true}' } }], usage: { prompt_tokens: 10, completion_tokens: 20, cost: 0.000003 }, content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }));
  }) as typeof fetch;
  const request: CompletionRequest = { system: 's', prompt: 'p', model: 'anthropic/claude-haiku-5.5', apiKey: 'mock', endpoint: 'https://openrouter.ai/api/v1/chat/completions', maxTokens: 2048 };
  try {
    const provider = new OpenAIProvider();
    const result = await provider.complete({ ...request, reasoning: true, reasoningEffort: 'medium' });
    await provider.complete({ ...request, reasoning: true });
    await provider.complete({ ...request, reasoning: false, reasoningEffort: 'high' });
    await provider.complete({ ...request, reasoningEffort: 'high' });
    assert.deepEqual(sent.map(x => x.reasoning), [{ enabled: true, effort: 'medium' }, { enabled: true }, { enabled: false }, { enabled: false }]);
    assert.equal(result.usage.cost, 0.000003);
    assert.deepEqual(sent[0].usage, { include: true });
    assert.equal(sent[0].temperature, 0);
    assert.equal(sent[0].max_tokens, 2048);
    await new AnthropicProvider().complete({ ...request, endpoint: 'https://api.anthropic.com/v1/messages', reasoning: true, reasoningEffort: 'medium' });
    assert.deepEqual(sent[4].thinking, { type: 'disabled' });
    assert.equal(sent[4].reasoning, undefined);
    assert.equal(sent[4].reasoning_effort, undefined);
  } finally { globalThis.fetch = original; }
});

test('gateway keeps B1 budget, doubles on truncation, and isolates editor effort', async () => {
  const requests: CompletionRequest[] = []; let first = true;
  const transport: Provider = { async complete(request) {
    requests.push({ ...request });
    if (request.reasoning && first) { first = false; throw new ProviderError('truncated', true, 'mock'); }
    return { text: '{}', finishReason: 'stop', usage: { input_tokens: 10, output_tokens: 10, cost: 0.000001 }, ms: 1 };
  } };
  const config = configSchema.parse({ providers: { p: { transport: 'local' } }, profiles: { edit: { provider: 'p', model: 'editor' }, verify: { provider: 'p', model: 'verifier', reasoning: true, reasoning_effort: 'medium' } } });
  const gateway = new Gateway(config, (await loadPack('en')).pack, {}, { local: transport });
  await gateway.complete('verify', 'verify', 's', 'p', 240);
  await gateway.complete('edit', 'edit', 's', 'p', 1);
  assert.deepEqual(requests.map(x => x.maxTokens), [2048, 4096, 256]);
  assert.deepEqual(requests.map(x => x.reasoningEffort), ['medium', 'medium', undefined]);
  assert.equal(gateway.ledger[1]?.budget, 4096);
  assert.equal(gateway.ledger[1]?.cost, 0.000001);
});
