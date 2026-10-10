import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { configSchema } from '../src/config.ts';
import { loadPack } from '../src/lang/pack.ts';
import { verifyMeaning } from '../src/guard/verify.ts';
import { Gateway } from '../src/provider/gateway.ts';
import { LocalProvider } from '../src/provider/local.ts';
import { Cache } from '../src/cache.ts';
import { guardProposals } from '../src/guard/index.ts';
import { splitScenes } from '../src/book.ts';
import { makeProposal } from '../src/proposal/identity.ts';

test('necessity requires unanimous passes even when only the third disagrees; cache modes are isolated', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rollout-cache-'));
  try {
    const pack = (await loadPack('en')).pack;
    const config = configSchema.parse({ providers: { p: { transport: 'local' } }, profiles: { verify: { provider: 'p', model: 'm', passes: 3 } } });
    let calls = 0;
    const local = new LocalProvider(() => JSON.stringify({ preserved: true, necessary: ++calls !== 3, reason: 'decision' }));
    const args = ['teh', 'the', 'teh door', 'prose', config, pack, new Cache(dir), new Gateway(config, pack, {}, { local })] as const;
    const meaning = await verifyMeaning(...args);
    assert.equal(meaning.passed, true);
    calls = 0;
    const necessity = await verifyMeaning(...args, { necessity: true });
    assert.equal(calls, 3, 'meaning cache cannot answer necessity');
    assert.equal(necessity.passed, false);
    assert.equal(necessity.agreed, 2);
    assert.match(necessity.reason, /^unnecessary:/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('proofread still performs objective necessity plus meaning, without combined copy necessity', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rollout-proofread-'));
  try {
    const script = path.join(dir, 'mock.json');
    await writeFile(script, JSON.stringify({ responses: { m: '{"necessary":true,"preserved":true,"reason":"typo"}' } }));
    const config = configSchema.parse({ providers: { p: { transport: 'local', endpoint: script } }, profiles: { verify: { provider: 'p', model: 'm', passes: 3, check: 'necessity' } } });
    const text = 'He saw teh door.';
    const book = { lang: 'en', chapters: [{ slug: 'one', title: 'One', file: 'one.md', text, scenes: splitScenes(text) }] };
    const proposal = makeProposal({ chapter: 'one', scene: book.chapters[0]!.scenes[0]!.id, category: 'spelling', target: 'teh', replacement: 'the', sceneText: text, source: 'model', unverified: true });
    const result = await guardProposals({ book, stateDir: dir } as never, { config, winningLayer: {}, warnings: [] }, await loadPack('en'), [proposal], true, 'proofread');
    assert.equal(result.proposals.length, 1);
    assert.equal(result.ledger.length, 4);
    const audit = result.stage.verifications as Array<{ answers: Array<{ preserved: boolean; necessary?: boolean }> }>;
    assert.deepEqual(audit[0]!.answers, [{ preserved: true }, { preserved: true }, { preserved: true }]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
