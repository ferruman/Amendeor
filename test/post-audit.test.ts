import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { openSource } from '../src/source/index.ts';
import { loadConfig } from '../src/config.ts';
import { loadPack } from '../src/lang/pack.ts';
import { editMechanical } from '../src/edit/mechanical.ts';
import { rejectProposals } from '../src/edited/decisions.ts';
import { makeProposal } from '../src/proposal/identity.ts';
import { guardProposals } from '../src/guard/index.ts';
import { semanticTrap } from '../src/guard/traps.ts';
import { splitScenes, type Book } from '../src/book.ts';
import { planMutations, type Mutation } from '../eval/mutate.ts';
import { outcome, scoreByPolicy } from '../eval/score.ts';
import { Gateway } from '../src/provider/gateway.ts';
import { LocalProvider } from '../src/provider/local.ts';
import { configSchema } from '../src/config.ts';

// Доработки после аудита: ../../docs/audits/2026-10-10-amendeor/amendeor-post-audit-hardening-2026-10-10.md.

function bookWith(text: string, lang: string): Book { return { lang, chapters: [{ slug: 'one', title: 'One', file: 'one.md', text, scenes: splitScenes(text) }] }; }

async function withVerifier<T>(answer: object, cli: Record<string, unknown>, run: (loaded: Awaited<ReturnType<typeof loadConfig>>, dir: string) => Promise<T>, editor: object = { edits: [] }): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'amendeor-post-audit-'));
  try {
    const script = path.join(dir, 'script.json');
    await writeFile(script, JSON.stringify({ responses: { verifier: JSON.stringify(answer), editor: JSON.stringify(editor) } }));
    const loaded = await loadConfig({ env: { HOME: dir }, cli: { providers: { local: { transport: 'local', endpoint: script } }, profiles: { edit: { provider: 'local', model: 'editor' }, verify: { provider: 'local', model: 'verifier' } }, ...cli } });
    return await run(loaded, dir);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

async function guard(text: string, lang: string, edits: Array<[string, string, string]>, cli: Record<string, unknown> = {}, rules: Array<[string, string, string]> = []) {
  const book = bookWith(text, lang); const scene = book.chapters[0]!.scenes[0]!;
  const make = (source: string) => ([target, replacement, category]: [string, string, string]) => makeProposal({ chapter: 'one', scene: scene.id, category: category as never, target, replacement, sceneText: scene.text, source, unverified: source === 'model' ? true : undefined });
  return withVerifier({ preserved: true, reason: 'ok' }, cli, async (loaded, dir) => {
    const result = await guardProposals({ book, stateDir: dir } as never, loaded, await loadPack(lang), edits.map(make('model')), true, 'copy', rules.map(make('rule:repetition.doubled-word')));
    return { ...result, verifyCalls: result.ledger.filter((entry) => entry.stage === 'verify').length };
  });
}

// Phase 1 — детерминированные отказы не тратят вызовы verifier.
test('PA-1: a voice-rejected edit makes zero verifier calls; a surviving edit still reaches the verifier', async () => {
  const rejected = await guard('“i am here,” he said.', 'en', [['“i am', '“I am', 'grammar']]);
  assert.deepEqual(rejected.rejected.map((item) => [item.guard, item.reason]), [['voice', 'dialogue-register-preserved']]);
  assert.equal(rejected.verifyCalls, 0);
  const surviving = await guard('He sayd nothing.', 'en', [['sayd', 'said', 'spelling']]);
  assert.equal(surviving.proposals.length, 1);
  assert.equal(surviving.verifyCalls, 3);
});

// Phase 2 — выбранная моделью категория dialogue-mechanics не разрешает менять слова реплики.
test('PA-2: dialogue-mechanics keeps objective mechanics and refuses content written under its label', async () => {
  const { pack } = await loadPack('en');
  const model = { category: 'dialogue-mechanics' as const, inDialogue: true, modelGenerated: true };
  // Пунктуация реплики: путь детерминированных правил (не модели) не задевает защиту реплики; модельную ловит прежнее правило T7.
  assert.equal(semanticTrap('“Go home” he said', '“Go home,” he said', pack, { ...model, modelGenerated: false }), null);
  assert.equal(semanticTrap('“Go home” he said', '“Go home,” he said', pack, model), 'unsupported-comma-change');
  assert.equal(semanticTrap('“Go home” he said', '“Go home!” he said', pack, model), 'punctuation-style-only');
  assert.equal(semanticTrap('“Well, good-night, Poole Poole.”', '“Well, good-night, Poole,” said the lawyer.', pack, model), 'dialogue-mechanics-content-change');
  assert.equal(semanticTrap('“Go home.”', '“Go home now.”', pack, model), 'dialogue-mechanics-content-change');
  assert.equal(semanticTrap('“I am goign home.”', '“I am going home.”', pack, model), 'dialogue-mechanics-content-change');
  assert.equal(semanticTrap('“I am goign home.”', '“I am going home.”', pack, { ...model, dialogueTypoAuthorized: true }), null);
  assert.equal(semanticTrap('“I am goign home.”', '“I am leaving home.”', pack, { ...model, dialogueTypoAuthorized: true }), 'dialogue-mechanics-content-change');
});

test('PA-2: guarded dialogue edits — capitalization passes, straddles and inventions are refused, adjacent narration is not dialogue', async () => {
  const caps = await guard('“go home,” he said.', 'en', [['“go home,”', '“Go home,”', 'dialogue-mechanics']]);
  assert.equal(caps.proposals.length, 1, JSON.stringify(caps.rejected));
  const lawyer = await guard('“Well, good-night, Poole Poole.”', 'en', [['“Well, good-night, Poole Poole.”', '“Well, good-night, Poole,” said the lawyer.', 'dialogue-mechanics']]);
  assert.deepEqual(lawyer.rejected.map((item) => item.reason), ['dialogue-mechanics-content-change']);
  assert.equal(lawyer.verifyCalls, 0);
  const straddle = await guard('He turned. “I is going home,” he said.', 'en', [['He turned. “I is going', 'He turned. “I am going', 'dialogue-mechanics']]);
  assert.deepEqual(straddle.rejected.map((item) => item.reason), ['dialogue-mechanics-content-change']);
  const narration = await guard('“Go home,” he sayd.', 'en', [['home,” he sayd', 'home,” he said', 'dialogue-mechanics']]);
  assert.equal(narration.proposals.length, 1, JSON.stringify(narration.rejected));
  const typo = await guard('“I am goign home.”', 'en', [['goign', 'going', 'dialogue-mechanics']], { normalize: { spelling: 'american' } });
  assert.equal(typo.proposals.length, 1, JSON.stringify(typo.rejected));
  const dialect = await guard('“I am gwine home.”', 'en', [['gwine', 'going', 'spelling']], { preserve: ['dialect'] });
  assert.deepEqual(dialect.rejected.map((item) => item.reason), ['dialogue-content-change']);
});

// Phase 3 — правило-дубль предпочтительнее модельной правки тех же знаков.
test('PA-3: a model edit touching the doubled word yields to the rule; an unrelated model edit does not', async () => {
  const text = 'Он не сказал снова снова и вышел.';
  const rule: Array<[string, string, string]> = [['снова снова', 'снова', 'repetition']];
  const exact = await guard(text, 'ru', [['снова снова', 'снова', 'repetition']], {}, rule);
  assert.deepEqual(exact.rejected.map((item) => item.guard), ['rule-preferred']);
  const drift = await guard(text, 'ru', [['не сказал снова снова и вышел', 'не сказал и снова вышел', 'repetition']], {}, rule);
  assert.deepEqual(drift.rejected.map((item) => item.guard), ['rule-preferred']);
  assert.equal(drift.verifyCalls, 0);
  const unrelated = await guard(text, 'ru', [['Он не', 'Он ведь не', 'clarity']], {}, rule);
  assert.ok(!unrelated.rejected.some((item) => item.guard === 'rule-preferred'), JSON.stringify(unrelated.rejected));
});

async function editRun(text: string, cli: Record<string, unknown>, editor: object, before?: (source: Awaited<ReturnType<typeof openSource>>, loaded: Awaited<ReturnType<typeof loadConfig>>) => Promise<void>) {
  return withVerifier({ preserved: true, reason: 'ok' }, cli, async (loaded, dir) => {
    const manuscript = path.join(dir, 'book.md');
    await writeFile(manuscript, text);
    const source = await openSource(manuscript, { lang: 'ru', out: path.join(dir, 'out') });
    if (before) await before(source, loaded);
    return editMechanical(source, loaded, await loadPack('ru'), { mode: 'copy', noCache: true });
  }, editor);
}

test('PA-3: rule preference respects a disabled rule, intentional repetition and an author rejection of the rule', async () => {
  const drift = { edits: [{ target: 'не сказал снова снова и вышел', replacement: 'не сказал и снова вышел', category: 'repetition', reason: 'Повтор.' }] };
  const reasons = (result: { run: Record<string, unknown> }) => ((result.run.guard as { rejections: Array<{ guard: string }> }).rejections).map((item) => item.guard);
  const on = await editRun('Он не сказал снова снова и вышел.\n', {}, drift);
  assert.ok(on.proposals.some((item) => item.source === 'rule:repetition.doubled-word'));
  assert.ok(!on.proposals.some((item) => item.source === 'model'));
  assert.deepEqual(reasons(on), ['rule-preferred']);
  const off = await editRun('Он не сказал снова снова и вышел.\n', { rules: { 'repetition.doubled-word': 'off' } }, drift);
  assert.ok(off.proposals.some((item) => item.source === 'model'), 'with the rule disabled the model edit goes to the verifier as before');
  const dialogue = { edits: [{ target: 'снова снова', replacement: 'снова', category: 'repetition', reason: 'Повтор.' }] };
  const intentional = await editRun('— Снова снова ты здесь, — сказал он.\n', { preserve: ['intentional-repetition'] }, dialogue);
  assert.ok(!intentional.proposals.some((item) => item.source === 'rule:repetition.doubled-word'));
  assert.ok(!reasons(intentional).includes('rule-preferred'));
  const authorRejected = await editRun('Он не сказал снова снова и вышел.\n', {}, drift, async (source, loaded) => {
    const first = await editMechanical(source, loaded, await loadPack('ru'), { mode: 'mechanical', noCache: true });
    await rejectProposals(source.stateDir, first.proposals.filter((item) => item.source === 'rule:repetition.doubled-word'), 'human:cli', source.editedDir);
  });
  assert.ok(!authorRejected.proposals.some((item) => item.source === 'rule:repetition.doubled-word'));
  assert.ok(!reasons(authorRejected).includes('rule-preferred'), 'a rejected rule proposal does not suppress the model');
});

// Phase 6B — заглавное слово в начале предложения не считается именем, если книга не пишет его с заглавной в середине.
test('PA-6B: sentence-initial typo fixes pass; name corruption and name introduction stay rejected', async () => {
  const en = (await loadPack('en')).pack, ru = (await loadPack('ru')).pack;
  const names = new Map([['Hyde', 12]]);
  const at = (prefix: string) => ({ category: 'spelling' as const, modelGenerated: true, nameContext: { prefix, bookNames: names } });
  assert.equal(semanticTrap('Somtimes he went.', 'Sometimes he went.', en, at('He paused. ')), null);
  assert.equal(semanticTrap('Somtimes he went.', 'Sometimes he went.', en, { category: 'spelling', modelGenerated: true }), 'proper-name-change', 'without scene context the old conservative rule holds');
  assert.equal(semanticTrap('Глдяела она.', 'Глядела она.', ru, at('')), null);
  assert.equal(semanticTrap('Hyde went.', 'Hide went.', en, at('He paused. ')), 'proper-name-change');
  assert.equal(semanticTrap('Hide went.', 'Hyde went.', en, at('He paused. ')), 'proper-name-change');
  assert.equal(semanticTrap('Hide', 'Hyde', en, at('the face of ')), 'proper-name-change');
  assert.equal(semanticTrap('Somtimes', 'Sometimes', en, at('and then ')), 'proper-name-change', 'a capitalized word mid-sentence stays a name');
});

// Phase 6C — неоднозначная цель в окне не правит первое попавшееся место.
test('PA-6C: an ambiguous target is discarded unless the model gives one identical edit per occurrence', async () => {
  const one = { edits: [{ target: 'сказл', replacement: 'сказал', category: 'spelling', reason: 'Опечатка.' }] };
  const ambiguous = await editRun('Он сказл да. Потом он сказл нет.\n', {}, one);
  assert.ok(!ambiguous.proposals.some((item) => item.source === 'model'));
  assert.ok(JSON.stringify(ambiguous.run.stages).includes('ambiguous-target-in-window'));
  const both = await editRun('Он сказл да. Потом он сказл нет.\n', {}, { edits: [one.edits[0], one.edits[0]] });
  assert.deepEqual(both.proposals.filter((item) => item.source === 'model').map((item) => item.target.occurrence).sort(), [0, 1]);
});

// Phase 4 — генератор мутаций v2.

for (const work of ['kashtanka-ru', 'jekyll-en']) test(`PA-4 ${work}: generator v2 keeps paragraphs, policy and determinism; v1 stays reproducible`, async () => {
  const base = `eval/fixtures/${work}`;
  const fixture = JSON.parse(await readFile(`${base}/fixture.json`, 'utf8'));
  const preserve = JSON.parse(await readFile(`${base}/preserve.json`, 'utf8'));
  const source = await openSource(`${base}/original`);
  const pack = (await loadPack(fixture.language)).pack;
  const paragraphs = (text: string) => (text.match(/\n\s*\n/g) ?? []).length;
  for (const seed of ['amendeor-v3', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']) {
    const plan = planMutations(source, fixture, preserve, pack, work, seed, true, { generator: 2, mode: 'copy' });
    for (const chapter of source.book.chapters) assert.equal(paragraphs(plan.chapters.get(chapter.file)!), paragraphs(chapter.text), `${seed}: paragraph boundaries changed in ${chapter.slug}`);
    for (const mutation of plan.mutations) {
      assert.ok(!/\n/.test(mutation.original) && !/\n/.test(mutation.mutated), `${seed}: ${mutation.id} crosses a line`);
      assert.notEqual(mutation.chapter, fixture.control_chapter);
      assert.ok(mutation.policy?.length, `${seed}: ${mutation.id} has no policy`);
      if (mutation.in_dialogue) assert.ok(['dialogue-format', 'doubled-word'].includes(mutation.type), `${seed}: ${mutation.type} placed in dialogue`);
      if (mutation.type === 'typo') assert.match(mutation.original, /^\p{Ll}/u, 'typos stay off capitalized (possibly proper) words');
      if (mutation.type === 'terminology') assert.deepEqual(mutation.policy, ['blocked-by-policy']);
      if (mutation.type === 'punctuation') assert.deepEqual(mutation.policy, ['proofread-only']);
    }
    assert.deepEqual(planMutations(source, fixture, preserve, pack, work, seed, true, { generator: 2, mode: 'copy' }), plan, 'fixed seed is deterministic');
  }
  // Зафиксированная фикстура v3 воспроизводится из генератора.
  const v3 = planMutations(source, fixture, preserve, pack, work, 'amendeor-v3', true, { generator: 2, mode: 'copy' });
  assert.deepEqual(JSON.parse(await readFile(`${base}/mutations-v3.json`, 'utf8')).mutations, v3.mutations);
  for (const chapter of source.book.chapters) assert.equal(await readFile(`${base}/mutated-v3/manuscript/chapters/${path.basename(chapter.file)}`, 'utf8'), v3.chapters.get(chapter.file));
  // v1 по-прежнему даёт историческую фикстуру (включая дефект AUD-F5 в русской мутации диалога).
  const v1 = planMutations(source, fixture, preserve, pack, work, 'amendeor-v2', true);
  assert.deepEqual(JSON.parse(await readFile(`${base}/formulaic-mutations.json`, 'utf8')).mutations, v1.mutations);
});

// Phase 5 — оценка отделяет обнаружение от исправления.
test('PA-5: outcomes separate exact, alternative, partial, incorrect and harmful; rejections are judged by policy', () => {
  const text = 'Он не сказал снова снова и вышел. Она пошёл домой.';
  const book = bookWith(text, 'ru'); const scene = book.chapters[0]!.scenes[0]!;
  const at = (needle: string) => ({ start: text.indexOf(needle), end: text.indexOf(needle) + needle.length });
  const redundancy: Mutation = { id: 'r', type: 'redundancy', chapter: 'one', scene: scene.id, span: at('сказал снова снова'), original: 'сказал', mutated: 'сказал снова снова', policy: ['model-fixable', 'rule-fixable'], alternatives: ['сказал снова'] };
  const strict: Mutation = { ...redundancy, id: 's', alternatives: [] };
  const agreement: Mutation = { id: 'a', type: 'agreement', chapter: 'one', scene: scene.id, span: at('пошёл'), original: 'пошла', mutated: 'пошёл', policy: ['model-fixable'] };
  const p = (target: string, replacement: string, source = 'model') => makeProposal({ chapter: 'one', scene: scene.id, category: 'grammar', target, replacement, sceneText: scene.text, source });
  assert.equal(outcome(text, p('не сказал снова снова и вышел', 'не сказал и вышел'), redundancy), 'exact');
  assert.equal(outcome(text, p('снова снова', 'снова'), redundancy), 'alternative');
  assert.equal(outcome(text, p('снова снова', 'снова'), strict), 'partial');
  assert.equal(outcome(text, p('не сказал снова снова и вышел', 'не сказал и снова вышел'), redundancy), 'incorrect');
  assert.equal(outcome(text, p('сказал снова снова и', 'сказал снова и снова и'), redundancy), 'incorrect');
  const harmful = [{ target: 'не сказал снова снова и вышел', replacement: 'не сказал и снова вышел', label: 'harmful' as const }];
  assert.equal(outcome(text, p('не сказал снова снова и вышел', 'не сказал и снова вышел'), redundancy, harmful), 'harmful');
  assert.equal(outcome(text, p('Она пошёл', 'Она пошла'), agreement), 'exact');
  // Обнаружение без исправления не считается правкой по политике.
  const drift = p('не сказал снова снова и вышел', 'не сказал и снова вышел'), fix = p('Она пошёл', 'Она пошла'), rule = p('снова снова', 'снова', 'rule:repetition.doubled-word');
  const score = scoreByPolicy(book, [redundancy, agreement], [drift, fix, rule], [drift], [{ proposal_id: fix.id, guard: 'semantic-trap', reason: 'x' }, { proposal_id: rule.id, guard: 'semantic-trap', reason: 'x' }], harmful);
  assert.equal(score.counts.detected, 2);
  assert.equal(score.counts.harmful, 1);
  assert.equal(score.counts.final_harmful, 1);
  assert.equal(score.counts.final_policy_compliant, 0);
  assert.deepEqual(score.rejections.items.map((item) => item.verdict), ['incorrect', 'incorrect']);
  const blocked = scoreByPolicy(book, [{ ...agreement, policy: ['blocked-by-policy'] }], [fix], [], [{ proposal_id: fix.id, guard: 'semantic-trap', reason: 'x' }]);
  assert.deepEqual(blocked.rejections.items.map((item) => item.verdict), ['correct']);
});

// B1 (бенчмарк 2026-10-10): reasoning-модель тратит выходной бюджет на рассуждение; 256 токенов обрезали почти каждый ответ.
test('B1: a reasoning profile gets the same output budget as a thinking profile', async () => {
  const seen: number[] = [];
  const local = new LocalProvider((request) => { seen.push(request.maxTokens); return '{"preserved":true,"reason":"ok"}'; });
  const config = (extra: object) => configSchema.parse({ providers: { p: { transport: 'local' } }, profiles: { verify: { provider: 'p', model: 'm', ...extra } } });
  const pack = (await loadPack('en')).pack;
  for (const extra of [{}, { reasoning: true }, { thinking: true }]) await new Gateway(config(extra), pack, {}, { local }).complete('verify', 'verify', 's', 'p', 240);
  assert.deepEqual(seen, [256, 2048, 2048]);
});
