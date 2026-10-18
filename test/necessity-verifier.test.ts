import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { configSchema } from '../src/config.ts';
import { loadConfig } from '../src/config.ts';
import { loadPack } from '../src/lang/pack.ts';
import { Cache } from '../src/cache.ts';
import { Gateway } from '../src/provider/gateway.ts';
import { LocalProvider } from '../src/provider/local.ts';
import { verifyMeaning } from '../src/guard/verify.ts';
import { guardProposals } from '../src/guard/index.ts';
import { makeProposal } from '../src/proposal/identity.ts';
import { splitScenes, type Book } from '../src/book.ts';

// Проверка необходимости в режиме copy (../../codicora-docs/runs/amendeor/amendeor-necessity-verifier-2026-10-10.md).

async function verify(answer: string, necessity: boolean, passes = 3) {
  const systems: string[] = [];
  const local = new LocalProvider((request) => { systems.push(request.system); return answer; });
  const config = configSchema.parse({ providers: { p: { transport: 'local' } }, profiles: { verify: { provider: 'p', model: 'm', passes } } });
  const pack = (await loadPack('en')).pack;
  const result = await verifyMeaning('teh', 'the', 'He saw teh door.', 'prose', config, pack, new Cache(os.tmpdir(), true), new Gateway(config, pack, {}, { local }), { necessity });
  return { ...result, systems };
}

test('NV-1: the decision follows both fields; a missing field fails safe; the default prompt is unchanged', async () => {
  const accept = await verify('{"necessary":true,"preserved":true,"reason":"typo"}', true);
  assert.equal(accept.passed, true);
  assert.equal(accept.systems.length, 3);
  assert.match(accept.systems[0]!, /NECESSARY/);
  assert.deepEqual(accept.answers, [{ necessary: true, preserved: true }, { necessary: true, preserved: true }, { necessary: true, preserved: true }]);
  const unnecessary = await verify('{"necessary":false,"preserved":true,"reason":"period spelling"}', true);
  assert.equal(unnecessary.passed, false);
  assert.equal(unnecessary.reason, 'unnecessary: period spelling');
  assert.equal(unnecessary.systems.length, 1, 'the first rejection stops further passes');
  const damaged = await verify('{"necessary":true,"preserved":false,"reason":"changes a fact"}', true);
  assert.equal(damaged.reason, 'not preserved: changes a fact');
  const both = await verify('{"necessary":false,"preserved":false,"reason":"x"}', true);
  assert.equal(both.passed, false);
  const missing = await verify('{"preserved":true,"reason":"fine"}', true);
  assert.equal(missing.passed, false);
  assert.match(missing.reason, /^verify failed/);
  const malformed = await verify('{"necessary":true,"preserved":true,"reason":"ok"', true);
  assert.match(malformed.reason, /^verify failed/);
  const meaningOnly = await verify('{"necessary":false,"preserved":true,"reason":"fine"}', false);
  assert.equal(meaningOnly.passed, true, 'without the necessity option a meaning-only answer decides, as before');
  assert.match(meaningOnly.systems[0]!, /strict semantic verifier/);
  assert.equal((await verify('{"necessary":true,"preserved":true,"reason":"ok"}', true, 1)).systems.length, 1);
});

test('NV-2: copy mode uses necessity only when profiles.verify.check is necessity; rejections stay in the audit log', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'amendeor-necessity-'));
  try {
    const script = path.join(dir, 'script.json');
    await writeFile(script, JSON.stringify({ responses: { verifier: '{"necessary":false,"preserved":true,"reason":"older spelling, not an error"}' } }));
    const text = 'He lay on the sopha all day.';
    const book: Book = { lang: 'en', chapters: [{ slug: 'one', title: 'One', file: 'one.md', text, scenes: splitScenes(text) }] };
    const scene = book.chapters[0]!.scenes[0]!;
    const proposal = makeProposal({ chapter: 'one', scene: scene.id, category: 'spelling', target: 'sopha', replacement: 'sofa', sceneText: scene.text, source: 'model', unverified: true });
    const run = async (check?: string, mode = 'copy') => guardProposals({ book, stateDir: dir } as never, await loadConfig({ env: { HOME: dir }, cli: { providers: { local: { transport: 'local', endpoint: script } }, profiles: { verify: { provider: 'local', model: 'verifier', passes: 1, ...(check ? { check } : {}) } } } }), await loadPack('en'), [proposal], true, mode);
    const necessity = await run('necessity');
    assert.equal(necessity.proposals.length, 0);
    assert.deepEqual(necessity.rejected.map((item) => [item.guard, item.reason, item.target]), [['semantic-verifier', 'unnecessary: older spelling, not an error', 'sopha']]);
    assert.equal((await run()).proposals.length, 1, 'production default (meaning) is unchanged');
    assert.equal((await run('meaning')).proposals.length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// Чистая фикстура (clean-ru): «нагнулся и…. апчхи!!!» — точка после многоточия не начинает предложение.
import { capitalization } from '../src/rules/capitalization.ts';
test('R1: capitalization leaves a lowercase word after an ellipsis alone, and still fixes a real sentence start', async () => {
  const pack = (await loadPack('ru')).pack;
  const ctx = { pack, config: { preserve: [] } } as never;
  for (const text of ['нагнулся и…. апчхи!!!', 'нагнулся и.... апчхи', 'Ждал... потом ушёл.']) assert.deepEqual(capitalization.detect({ text } as never, ctx), [], text);
  assert.equal(capitalization.detect({ text: 'Стой. потом иди.' } as never, ctx).length, 1);
});

// Бенчмарк 2026-10-10: «…через барьер; Тётка не допрыгнула» → «…; тётка не допрыгнула» прошла ловушку имён:
// имена сравнивались как множество, а «Тётка» оставалась в цели ещё раз.
import { semanticTrap } from '../src/guard/traps.ts';
test('T10: dropping one occurrence of a name that recurs in the target is a name change', async () => {
  const { pack } = await loadPack('ru');
  const options = { category: 'capitalization' as const, modelGenerated: true };
  assert.equal(semanticTrap('Тётка прыгнула через барьер; Тётка не допрыгнула', 'Тётка прыгнула через барьер; тётка не допрыгнула', pack, options), 'proper-name-change');
  assert.equal(semanticTrap('Тётка прыгнула через барьер; Тётка не допрыгнула', 'Тётка прыгнула через барьер; Тётка не допрыгнула.', pack, { category: 'punctuation' as const }), null, 'unchanged names still pass');
  assert.equal(semanticTrap('Каштанка подошла к Каштанку', 'Каштанка подошла к Каштанке', pack, { category: 'grammar' as const, modelGenerated: true }), null, 'a case-form fix of a recurring name is not a name change');
  assert.equal(semanticTrap('Иваныч Иваныч', 'Иваныч', pack, { category: 'repetition' as const, modelGenerated: true }), null, 'a doubled name may be deduplicated');
});
