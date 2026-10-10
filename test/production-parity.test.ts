import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parse } from 'yaml';
import { configSchema } from '../src/config.ts';
import { Gateway } from '../src/provider/gateway.ts';
import { loadPack } from '../src/lang/pack.ts';
import { necessityPromptVersion } from '../src/prompts/verify.ts';
import { copyEditPromptVersion } from '../src/prompts/copy-edit.ts';

// Сохранённый HTTP-запрос, а не только имена моделей: отклонения требуют явного пересмотра снимка.
test('production matches recorded necessity benchmark requests and behavior contracts', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/rollout/benchmark.json', import.meta.url), 'utf8'));
  const historical = await readFile(new URL('../' + fixture.source, import.meta.url));
  assert.equal(createHash('sha256').update(historical).digest('hex'), fixture.source_sha256, 'historical benchmark evidence changed');
  const rows = historical.toString().trim().split('\n').map(line => JSON.parse(line));
  for (const [role, request] of Object.entries(fixture.requests)) assert.ok(rows.some(row => row.role === role && row.status === 200 && row.job.includes(fixture.configuration) && JSON.stringify(row.request) === JSON.stringify(request)), 'fixture must be a successful recorded ' + role + ' request');
  const config = configSchema.parse(parse(await readFile(new URL('../amendeor.yaml', import.meta.url), 'utf8')));
  const pack = (await loadPack('ru')).pack;
  const original = globalThis.fetch; const requests: Array<{ url: string; body: any }> = [];
  globalThis.fetch = (async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{}' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
  }) as typeof fetch;
  try {
    for (const [role, profileName] of [['editor', 'edit'], ['verifier', 'verify']] as const) {
      const expected = fixture.requests[role];
      const profile = config.profiles[profileName]!;
      assert.equal(config.providers[profile.provider]!.transport, 'openai');
      const gateway = new Gateway(config, pack, { AMENDEOR_OPENROUTER_API_KEY: 'mock' });
      await gateway.complete(profileName, profileName, expected.messages[0].content, expected.messages[1].content, role === 'verifier' ? 240 : expected.max_tokens * pack.chars_per_token / 1.25);
      const actual = requests.at(-1)!;
      assert.equal(actual.url, 'https://openrouter.ai/api/v1/chat/completions');
      assert.deepEqual(actual.body, expected, role + ' HTTP payload');
    }
  } finally { globalThis.fetch = original; }
  assert.equal(config.profiles.edit!.context_budget, fixture.context_budget);
  assert.equal(config.profiles.verify!.passes, fixture.passes);
  assert.equal(config.profiles.verify!.check, fixture.check);
  assert.equal(copyEditPromptVersion, fixture.prompt_versions.editor);
  assert.equal(necessityPromptVersion, fixture.prompt_versions.verifier);
  for (const [file, digest] of Object.entries(fixture.behavior_sha256)) {
    const content = await readFile(new URL('../' + file, import.meta.url));
    assert.equal(createHash('sha256').update(content).digest('hex'), digest, file + ': JSON handling, retries or deterministic guard ordering changed; review parity');
  }
});
