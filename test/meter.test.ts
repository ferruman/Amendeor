import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CompletionRequest, Provider } from '../src/provider/types.ts';
import { Gateway } from '../src/provider/gateway.ts';
import { configSchema } from '../src/config.ts';
import { loadPack } from '../src/lang/pack.ts';
import { meter, SpendRefused, type Meter } from '../src/provider/meter.ts';
import { reserveSpend, settleSpend, spentUnder } from '../src/edited/authority.ts';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// A workspace whose delegation allows amendeor.edit up to `max` in `currency`; reservations go to its authority/.
async function delegated(max: number, currency = 'USD'): Promise<Meter> {
  const ws = await mkdtemp(path.join(os.tmpdir(), 'amendeor-meter-'));
  await mkdir(path.join(ws, 'authority'));
  await writeFile(path.join(ws, 'codicora.yaml'), 'spec: codicora/v1\nproject: { id: t }\n');
  await writeFile(path.join(ws, 'authority/delegations.json'), JSON.stringify({ schema: 'codicora.delegations/0.1', delegations: [{ id: 'r', workspace: 't', granted_by: 'author', granted_at: new Date(Date.now() - 6e4).toISOString(), expires_at: new Date(Date.now() + 36e5).toISOString(), allow: ['amendeor.edit'], limits: { max_spend: max, currency } }] }));
  return { spent: 0, ctx: { workspaceDir: ws, id: 'r', capability: 'amendeor.edit', actor: 'cli:test', subject: 'edit' } };
}

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
  const m = await delegated(1);
  await meter.run(m, () => new Gateway(priced, pack, {}, { local: transport }).complete('edit', 'edit', 'sys', 'prompt', 100));
  assert.equal(calls(), 1);
  assert.equal(m.spent, (100 * 1 + 50 * 2) / 1e6, 'actual, not the worst case');
  await new Gateway(unpriced, pack, {}, { local: transport }).complete('edit', 'edit', 'sys', 'prompt', 100);
  assert.equal(calls(), 2, 'a person at the CLI is not metered');
});

test('meter: over budget, no price, or another currency — refused before the provider is called, and stays refused', async () => {
  for (const [config, m, why] of [
    [priced, await delegated(0.000001), /over the delegated budget/],
    [unpriced, await delegated(10), /no price/],
    [priced, await delegated(10, 'EUR'), /no conversion/],
  ] as const) {
    const { transport, calls } = counting();
    const gateway = new Gateway(config, pack, {}, { local: transport });
    await assert.rejects(meter.run(m as Meter, () => gateway.complete('edit', 'edit', 'sys', 'prompt', 100)), (e: unknown) => e instanceof SpendRefused && why.test((e as Error).message));
    await assert.rejects(meter.run(m as Meter, () => gateway.complete('edit', 'edit', 'sys', 'p', 1)), SpendRefused);
    assert.equal(calls(), 0);
  }
});

test('budget race: two commands that each fit the remaining 5 but not together — only one reservation is written', async () => {
  const m = await delegated(5);
  const results = await Promise.allSettled([reserveSpend(m.ctx!, 4, 'USD'), reserveSpend(m.ctx!, 4, 'USD')]);
  assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
  assert.equal(await spentUnder(path.join(m.ctx!.workspaceDir, 'authority'), 'r', 'USD'), 4);
});

test('crash liability: a failed or unsettled call keeps its whole reservation; a settled one costs what it cost', async () => {
  const m = await delegated(1);
  const failing: Provider = { async complete() { throw new Error('connection reset after send'); } };
  await assert.rejects(meter.run(m, () => new Gateway(priced, pack, {}, { local: failing }).complete('edit', 'edit', 'sys', 'prompt', 100)));
  const dir = path.join(m.ctx!.workspaceDir, 'authority');
  const held = await spentUnder(dir, 'r', 'USD');
  assert.ok(held > 0, 'the unknown outcome is still a liability');
  const r = await reserveSpend(m.ctx!, 0.5, 'USD');
  await settleSpend(r, 'r', 0.1, 'USD');
  assert.equal(Math.round((await spentUnder(dir, 'r', 'USD')) * 1e9), Math.round((held + 0.1) * 1e9));
});
