import assert from 'node:assert/strict';
import { test } from 'node:test';
import { postJson } from '../src/provider/http.ts';
import { ProviderError, type CompletionRequest, type Provider } from '../src/provider/types.ts';
import { Gateway } from '../src/provider/gateway.ts';
import { configSchema } from '../src/config.ts';
import { loadPack } from '../src/lang/pack.ts';
import { LocalProvider } from '../src/provider/local.ts';
import { OpenAIProvider } from '../src/provider/openai.ts';
import { AnthropicProvider } from '../src/provider/anthropic.ts';

test('stalled response body becomes a retryable timeout', async () => {
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => ({
    ok: true, status: 200,
    text: () => new Promise<string>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
  })) as unknown as typeof fetch;
  await assert.rejects(postJson('https://example.invalid', {}, {}, 20, fetcher), (error: unknown) => error instanceof ProviderError && error.kind === 'timeout' && error.retryable);
});

test('rate limit errors retain retry timing without echoing request content', async () => {
  const reset = Date.now() + 4000;
  const fetcher = (async () => ({ ok: false, status: 429, headers: { get: () => null }, text: async () => JSON.stringify({ error: { type: 'rate_limit_error', message: 'slow down' }, metadata: { headers: { 'X-RateLimit-Reset': String(reset) }, flagged_input: 'private manuscript' } }) })) as unknown as typeof fetch;
  await assert.rejects(postJson('https://example.invalid', {}, {}, 1000, fetcher), (error: unknown) => error instanceof ProviderError && error.retryable && (error.retryAfterMs ?? 0) >= 3500 && !error.diagnosis.includes('private manuscript'));
});

test('gateway retries a transient error, measures density, and records priced calls', async () => {
  const pack = (await loadPack('ru')).pack;
  const config = configSchema.parse({ providers: { scripted: { transport: 'local', price: { input_per_m: 1, output_per_m: 2, currency: 'USD' } } }, profiles: { edit: { provider: 'scripted', model: 'fixture' } } });
  const budgets: number[] = []; let calls = 0;
  const transport: Provider = { async complete(request: CompletionRequest) {
    budgets.push(request.maxTokens); calls++;
    if (calls === 1) throw new ProviderError('network', true, 'temporary');
    return { text: '{"edits":[]}', finishReason: 'stop', usage: { input_tokens: 1000, output_tokens: 10 }, ms: 7 };
  } };
  const gateway = new Gateway(config, pack, {}, { local: transport });
  await gateway.complete('edit', 'edit', 'system', 'текст'.repeat(80), 1000);
  await gateway.complete('edit', 'edit', 'system', 'текст'.repeat(80), 1000);
  assert.equal(calls, 3);
  assert.ok(budgets[2]! > budgets[1]!);
  assert.equal(gateway.ledger.length, 3);
  assert.equal(gateway.ledger[0]?.error?.startsWith('network:'), true);
  assert.ok(gateway.ledger.slice(1).every((entry) => entry.cost !== null && entry.cost! > 0));
});

test('local script needs no key and returns NO_CHANGE', async () => {
  const result = await new LocalProvider().complete({ system: '', prompt: 'text', model: 'fixture', maxTokens: 256 });
  assert.equal(result.text, '{"edits":[]}');
});

test('gateway accepts a local script path as its endpoint', async () => {
  const pack = (await loadPack('en')).pack;
  const config = configSchema.parse({ providers: { local: { transport: 'local', endpoint: '/tmp/amendeor-script.json' } }, profiles: { edit: { provider: 'local', model: 'fixture' } } });
  const transport: Provider = { async complete() { return { text: '{"edits":[]}', finishReason: 'stop', usage: { input_tokens: 1, output_tokens: 1 }, ms: 1 }; } };
  assert.equal((await new Gateway(config, pack, {}, { local: transport }).complete('edit', 'edit', '', '', 100)).text, '{"edits":[]}');
});

test('OpenAI null content reports the output budget and disables reasoning', async () => {
  const original = globalThis.fetch; let sent: any;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body));
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: null }, finish_reason: 'length' }] }) } as Response;
  }) as typeof fetch;
  try {
    await assert.rejects(new OpenAIProvider().complete({ system: 's', prompt: 'p', model: 'fixture', maxTokens: 321, apiKey: 'test', endpoint: 'https://openrouter.ai/api/v1/chat/completions' }),
      (error: unknown) => error instanceof ProviderError && error.kind === 'truncated' && error.diagnosis.includes('321'));
    assert.deepEqual(sent.reasoning, { enabled: false });
  } finally { globalThis.fetch = original; }
});

test('Anthropic disables thinking and reports block types', async () => {
  const original = globalThis.fetch; let sent: any;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body));
    return { ok: true, status: 200, text: async () => JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: 'hidden' }, { type: 'text', text: '{"edits":[]}' }], usage: { input_tokens: 3, output_tokens: 4 } }) } as Response;
  }) as typeof fetch;
  try {
    const result = await new AnthropicProvider().complete({ system: 's', prompt: 'p', model: 'fixture', maxTokens: 321, apiKey: 'test' });
    assert.deepEqual(sent.thinking, { type: 'disabled' });
    assert.equal(result.diagnostics, 'blocks=thinking,text');
  } finally { globalThis.fetch = original; }
});
