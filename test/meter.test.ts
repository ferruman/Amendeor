import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CompletionRequest, Provider } from '../src/provider/types.ts';
import { Gateway } from '../src/provider/gateway.ts';
import { configSchema } from '../src/config.ts';
import { loadPack } from '../src/lang/pack.ts';
import { meter, SpendRefused, type Meter } from '../src/provider/meter.ts';

const pack = (await loadPack('ru', 'Текст.')).pack;
const priced = configSchema.parse({ providers: { p: { transport: 'local', price: { input_per_m: 1, output_per_m: 2, currency: 'USD' } } }, profiles: { edit: { provider: 'p', model: 'm' } } });
const unpriced = configSchema.parse({ providers: { p: { transport: 'local' } }, profiles: { edit: { provider: 'p', model: 'm' } } });
const counting = () => {
  let calls = 0;
  const transport: Provider = { async complete(_request: CompletionRequest) { calls++; return { text: 'ok', finishReason: 'stop', usage: { input_tokens: 100, output_tokens: 50 }, ms: 1 }; } };
  return { transport, calls: () => calls };
};

test('meter: a call that fits is made and its actual cost counted; without a meter nothing changes', async () => {
  const { transport, calls } = counting();
  const m: Meter = { remaining: 1, currency: 'USD', spent: 0 };
  await meter.run(m, () => new Gateway(priced, pack, {}, { local: transport }).complete('edit', 'edit', 'sys', 'prompt', 100));
  assert.equal(calls(), 1);
  assert.equal(m.spent, (100 * 1 + 50 * 2) / 1e6, 'actual, not the worst case');
  await new Gateway(unpriced, pack, {}, { local: transport }).complete('edit', 'edit', 'sys', 'prompt', 100);
  assert.equal(calls(), 2, 'a person at the CLI is not metered');
});

test('meter: over budget, no price, or another currency — refused before the provider is called, and stays refused', async () => {
  for (const [config, m, why] of [
    [priced, { remaining: 0.000001, currency: 'USD', spent: 0 }, /over the delegated budget/],
    [unpriced, { remaining: 10, currency: 'USD', spent: 0 }, /no price/],
    [priced, { remaining: 10, currency: 'EUR', spent: 0 }, /no conversion/],
  ] as const) {
    const { transport, calls } = counting();
    const gateway = new Gateway(config, pack, {}, { local: transport });
    await assert.rejects(meter.run(m as Meter, () => gateway.complete('edit', 'edit', 'sys', 'prompt', 100)), (e: unknown) => e instanceof SpendRefused && why.test((e as Error).message));
    await assert.rejects(meter.run(m as Meter, () => gateway.complete('edit', 'edit', 'sys', 'p', 1)), SpendRefused);
    assert.equal(calls(), 0);
  }
});
