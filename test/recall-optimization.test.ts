import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { configSchema, effectivePreserve, loadConfig } from '../src/config.ts';
import { loadPack } from '../src/lang/pack.ts';
import { openSource } from '../src/source/index.ts';
import { editMechanical } from '../src/edit/mechanical.ts';
import { mergePasses, type Placed } from '../src/edit/merge.ts';
import { makeProposal } from '../src/proposal/identity.ts';
import { proposalSchema } from '../src/proposal/schema.ts';
import { deterministicGuard, editorialContext, guardProposals } from '../src/guard/index.ts';
import { verifyMeaning } from '../src/guard/verify.ts';
import { voiceGuard } from '../src/guard/voice.ts';
import { Cache } from '../src/cache.ts';
import { Gateway } from '../src/provider/gateway.ts';
import { LocalProvider } from '../src/provider/local.ts';
import { copyEditPrompt, diagnosticEditPrompt, diagnosticPromptVersion } from '../src/prompts/copy-edit.ts';
import { necessityContextPromptVersion } from '../src/prompts/verify.ts';
import { splitScenes, type Book } from '../src/book.ts';

// Полнота, контекст verifier и профили сохранения (2026-10-11).

const book = (text: string, lang = 'en'): Book => ({ lang, chapters: [{ slug: 'one', title: 'One', file: 'one.md', text, scenes: splitScenes(text) }] });
function placed(text: string, target: string, replacement: string, pass: 'standard' | 'diagnostic', nth = 0, category: 'spelling' | 'grammar' = 'spelling'): Placed {
  let start = -1; for (let i = 0; i <= nth; i++) start = text.indexOf(target, start + 1);
  const scene = splitScenes(text)[0]!;
  return { pass, start, proposal: makeProposal({ chapter: 'one', scene: scene.id, category, target, replacement, sceneText: text, occurrence: text.slice(0, start).split(target).length - 1, source: 'model', unverified: true }) };
}

test('MERGE: identical and equivalent edits merge with provenance; ordering and ids do not depend on pass order', () => {
  const text = 'He saw teh dog near teh gate.';
  const identical = mergePasses(text, [placed(text, 'teh dog', 'the dog', 'standard'), placed(text, 'teh dog', 'the dog', 'diagnostic')]);
  assert.equal(identical.proposals.length, 1); assert.equal(identical.merged, 1);
  assert.deepEqual(identical.proposals[0]!.passes, ['standard', 'diagnostic']);
  const equivalent = mergePasses(text, [placed(text, 'saw teh dog', 'saw the dog', 'standard'), placed(text, 'teh', 'the', 'diagnostic')]);
  assert.equal(equivalent.proposals.length, 1);
  assert.equal(equivalent.proposals[0]!.target.text, 'teh', 'shortest target represents equivalent edits');
  assert.deepEqual(equivalent.proposals[0]!.passes, ['standard', 'diagnostic']);
  const a = [placed(text, 'teh', 'the', 'standard', 0), placed(text, 'teh', 'the', 'diagnostic', 1)];
  const forward = mergePasses(text, a), backward = mergePasses(text, [...a].reverse());
  assert.deepEqual(forward.proposals.map((p) => p.id), backward.proposals.map((p) => p.id), 'stable ids and order');
  assert.equal(forward.proposals.length, 2, 'repeated target strings at different places stay separate');
  assert.notEqual(forward.proposals[0]!.id, forward.proposals[1]!.id);
  assert.deepEqual(forward.proposals.map((p) => p.passes), [['standard'], ['diagnostic']]);
});

test('MERGE: conflicting, partial and nested edits from different passes are deferred, never combined', () => {
  const text = 'She were tired and slept.';
  const same = mergePasses(text, [placed(text, 'were', 'was', 'standard', 0, 'grammar'), placed(text, 'were', 'is', 'diagnostic', 0, 'grammar')]);
  assert.equal(same.proposals.length, 0); assert.equal(same.conflicts.length, 1);
  assert.deepEqual(same.conflicts[0]!.edits.map((edit) => edit.replacement).sort(), ['is', 'was']);
  const partial = mergePasses(text, [placed(text, 'She were', 'She was', 'standard', 0, 'grammar'), placed(text, 'were tired', 'were tyred', 'diagnostic', 0, 'grammar')]);
  assert.equal(partial.proposals.length, 0, 'overlap through the shared word «were» is a conflict');
  const nested = mergePasses(text, [placed(text, 'She were tired', 'She was very tired', 'standard', 0, 'grammar'), placed(text, 'were', 'was', 'diagnostic', 0, 'grammar')]);
  assert.equal(nested.proposals.length, 0); assert.equal(nested.conflicts.length, 1);
  const adjacent = mergePasses(text, [placed(text, 'were', 'was', 'standard', 0, 'grammar'), placed(text, 'slept', 'sleept', 'diagnostic')]);
  assert.equal(adjacent.proposals.length, 2, 'non-overlapping edits are both kept');
  const withinOnePass = mergePasses(text, [placed(text, 'She were', 'She was', 'standard', 0, 'grammar'), placed(text, 'were tired', 'were tyred', 'standard', 0, 'grammar')]);
  assert.equal(withinOnePass.proposals.length, 2, 'overlaps inside one pass keep the earlier behaviour (build reports them)');
  for (const empty of [[], [placed(text, 'were', 'was', 'standard', 0, 'grammar')], [placed(text, 'were', 'was', 'diagnostic', 0, 'grammar')]]) assert.equal(mergePasses(text, empty).proposals.length, empty.length);
  assert.ok(proposalSchema.safeParse(adjacent.proposals[0]).success, 'merged proposals keep the proposal contract');
});

test('MERGE: diagnostic proposals get no bypass — rule preference, dialogue and names apply as to standard ones', async () => {
  const { pack } = await loadPack('en');
  const config = configSchema.parse({});
  const check = (text: string, target: string, replacement: string, category: 'repetition' | 'grammar' | 'spelling', rules: ReturnType<typeof makeProposal>[] = []) => {
    const b = book(text); const scene = b.chapters[0]!.scenes[0]!;
    const proposal = { ...makeProposal({ chapter: 'one', scene: scene.id, category, target, replacement, sceneText: scene.text, source: 'model', unverified: true }), passes: ['diagnostic' as const] };
    const result = deterministicGuard(proposal, scene.text, b, pack, config, 'copy', rules);
    return 'guard' in result ? result.reason.split(' ')[0] : 'passes';
  };
  const text = 'He was again again tired.'; const scene = book(text).chapters[0]!.scenes[0]!;
  const rule = makeProposal({ chapter: 'one', scene: scene.id, category: 'repetition', target: 'again again', replacement: 'again', sceneText: text, source: 'rule:repetition.doubled-word' });
  assert.equal(check(text, 'was again again tired', 'was tired', 'repetition', [rule]), 'rule:repetition.doubled-word');
  assert.equal(check('He turned. “I is going,” he said.', 'He turned. “I is', 'He turned. “I am', 'grammar'), 'dialogue-content-change');
  assert.equal(check('Then Hyde went home.', 'Hyde', 'Hide', 'spelling'), 'proper-name-change');
});

test('DUAL: the diagnostic pass runs on the same source, merges identical proposals and verifies each once', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'amendeor-dual-'));
  try {
    const manuscript = path.join(dir, 'book.md'); const script = path.join(dir, 'script.json');
    await writeFile(manuscript, 'He saw teh dog.\n');
    await writeFile(script, JSON.stringify({ responses: { editor: JSON.stringify({ edits: [{ target: 'teh', replacement: 'the', category: 'spelling', reason: 'typo' }] }), verifier: '{"necessary":true,"preserved":true,"reason":"typo"}' } }));
    const run = async (diagnostic: boolean) => {
      const source = await openSource(manuscript, { lang: 'en', out: path.join(dir, diagnostic ? 'dual' : 'single') });
      const loaded = await loadConfig({ env: { HOME: dir }, cli: { providers: { local: { transport: 'local', endpoint: script } }, profiles: { edit: { provider: 'local', model: 'editor', ...(diagnostic ? { diagnostic: true } : {}) }, verify: { provider: 'local', model: 'verifier', passes: 3, check: 'necessity' } } } });
      return editMechanical(source, loaded, await loadPack('en'), { mode: 'copy', noCache: true });
    };
    const single = await run(false), dual = await run(true);
    const model = (result: typeof single) => result.proposals.filter((p) => p.source === 'model');
    assert.equal(model(single)[0]!.passes, undefined, 'single-pass proposals keep the earlier shape');
    assert.deepEqual(model(dual).map((p) => p.passes), [['standard', 'diagnostic']]);
    assert.equal(model(dual)[0]!.id, model(single)[0]!.id, 'the merged proposal keeps the single-pass id');
    const ledger = (result: typeof single) => (result.run.ledger as { entries: Array<{ stage: string }> }).entries;
    assert.deepEqual([...new Set(ledger(dual).map((entry) => entry.stage))].sort(), ['edit', 'edit-diagnostic', 'verify']);
    assert.equal(ledger(dual).filter((entry) => entry.stage === 'verify').length, 3, 'one proposal, three verifier passes — not six');
    const stage = (single.run.stages as Array<Record<string, unknown>>).find((s) => s.name === 'model')!;
    assert.equal(stage.passes, undefined);
    const dualStage = (dual.run.stages as Array<Record<string, unknown>>).find((s) => s.name === 'model')!;
    assert.deepEqual([dualStage.merged_identical, dualStage.merge_conflicts, dualStage.diagnostic_prompt_version], [1, 0, diagnosticPromptVersion]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('PROMPTS: the diagnostic prompt differs from the standard one in exactly two lines and shares the preservation policy', async () => {
  const { pack } = await loadPack('ru');
  const config = configSchema.parse({ editorial_profile: { preservation: { historical_orthography: true, dialect: true }, protected_forms: ['тысячей лиц'] } });
  const standard = copyEditPrompt(pack, 'текст', '', '', 'copy', config).system.split('\n');
  const diagnostic = diagnosticEditPrompt(pack, 'текст', '', '', 'copy', config).system.split('\n');
  assert.equal(standard.length, diagnostic.length);
  assert.equal(diagnostic.filter((line) => !standard.includes(line)).length, 2);
  const preserve = standard.find((line) => line.startsWith('Preserve: '));
  assert.equal(preserve, 'Preserve: dialect, historical-orthography, тысячей лиц.');
  assert.ok(diagnostic.includes(preserve!));
});

test('PROFILE: flags inherit into the existing preserve words; protected forms block model and rule edits but not nearby errors', async () => {
  const config = configSchema.parse({ preserve: ['sentence-fragments'], editorial_profile: { preservation: { dialect: true, authorial_repetition: true, period_grammar: true }, protected_forms: ['тысячей лиц'] } });
  assert.deepEqual(effectivePreserve(config), ['sentence-fragments', 'dialect', 'intentional-repetition', 'period-grammar', 'тысячей лиц']);
  assert.deepEqual(effectivePreserve(configSchema.parse({})), []);
  const { pack } = await loadPack('ru');
  const text = 'Ему было вессело в присутствии тысячей лиц.'; const b = book(text, 'ru'); const scene = b.chapters[0]!.scenes[0]!;
  const proposal = (target: string, replacement: string) => makeProposal({ chapter: 'one', scene: scene.id, category: 'grammar', target, replacement, sceneText: text, source: 'model', unverified: true });
  const guard = (target: string, replacement: string, c = config) => { const r = deterministicGuard(proposal(target, replacement), text, b, pack, c, 'copy'); return 'guard' in r ? r.reason : 'passes'; };
  assert.equal(guard('тысячей лиц', 'тысячи лиц'), 'protected-form');
  assert.equal(guard('в присутствии тысячей', 'в присутствии тысяч'), 'protected-form');
  assert.equal(guard('вессело', 'весело'), 'passes', 'an unrelated typo in the same sentence is still corrected');
  assert.equal(guard('тысячей лиц', 'тысячи лиц', configSchema.parse({})), 'passes', 'without a profile nothing is protected');
  // Диалект профиля действует так же, как preserve: [dialect].
  const speech = '— Нешто я знаю, — сказал он.'; const sb = book(speech, 'ru'); const ss = sb.chapters[0]!.scenes[0]!;
  const dialect = { ...makeProposal({ chapter: 'one', scene: ss.id, category: 'spelling', target: 'Нешто', replacement: 'Разве', sceneText: speech, source: 'model', unverified: true }) };
  assert.equal(voiceGuard(dialect, speech, sb, pack, configSchema.parse({ editorial_profile: { preservation: { dialect: true } } })), voiceGuard(dialect, speech, sb, pack, configSchema.parse({ preserve: ['dialect'] })));
  // Правило-дубль не трогает защищённую форму; профиль входит в ключ кэша редактора.
  const dir = await mkdtemp(path.join(os.tmpdir(), 'amendeor-profile-'));
  try {
    const manuscript = path.join(dir, 'book.md'); await writeFile(manuscript, 'He saw the the dog. She said said nothing.\n');
    const source = await openSource(manuscript, { lang: 'en', out: path.join(dir, 'out') });
    const result = await editMechanical(source, await loadConfig({ env: { HOME: dir }, cli: { editorial_profile: { protected_forms: ['the the'] } } }), await loadPack('en'), { mode: 'mechanical', noCache: true });
    assert.deepEqual(result.proposals.filter((p) => p.source === 'rule:repetition.doubled-word').map((p) => p.target.text), ['said said']);
    assert.equal((result.run.stages as Array<Record<string, unknown>>)[0]!.protected_form_skipped, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('CACHE: the editorial profile is part of the editor and verifier cache keys', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'amendeor-cache-'));
  try {
    const manuscript = path.join(dir, 'book.md'); const script = path.join(dir, 'script.json');
    await writeFile(manuscript, 'He saw teh dog.\n');
    await writeFile(script, JSON.stringify({ responses: { editor: '{"edits":[]}' } }));
    const run = async (profile?: object) => {
      const source = await openSource(manuscript, { lang: 'en', out: path.join(dir, 'out') });
      const loaded = await loadConfig({ env: { HOME: dir }, cli: { providers: { local: { transport: 'local', endpoint: script } }, profiles: { edit: { provider: 'local', model: 'editor' } }, ...(profile ? { editorial_profile: profile } : {}) } });
      const result = await editMechanical(source, loaded, await loadPack('en'), { mode: 'copy' });
      return (result.run.ledger as { entries: unknown[] }).entries.length;
    };
    assert.equal(await run(), 1); assert.equal(await run(), 0, 'cached');
    assert.equal(await run({ preservation: { historical_orthography: true } }), 1, 'a profile change is a new editor question');
  } finally { await rm(dir, { recursive: true, force: true }); }
  const calls: string[] = [];
  const local = new LocalProvider((request) => { calls.push(request.system); return '{"necessary":true,"preserved":true,"reason":"ok"}'; });
  const config = configSchema.parse({ providers: { p: { transport: 'local' } }, profiles: { verify: { provider: 'p', model: 'm', passes: 1 } } });
  const pack = (await loadPack('en')).pack; const cache = new Cache(await mkdtemp(path.join(os.tmpdir(), 'amendeor-vcache-')), false);
  const ask = (context: unknown) => verifyMeaning('teh', 'the', 'He saw teh dog.', 'prose', config, pack, cache, new Gateway(config, pack, {}, { local }), { necessity: true, context });
  await ask({ a: 1 }); await ask({ a: 1 }); await ask({ a: 2 }); await ask(undefined);
  assert.equal(calls.length, 3, 'same context hits the cache; another context or none asks again');
});

test('CONTEXT: structured context uses its own prompt, keeps three-pass unanimity, and marks unknowns explicitly', async () => {
  const answers = ['{"necessary":true,"preserved":true,"reason":"agreement"}', '{"necessary":false,"preserved":true,"reason":"recurring idiom"}', '{"necessary":true,"preserved":true,"reason":"x"}'];
  const systems: string[] = [], prompts: string[] = [];
  const local = new LocalProvider((request) => { systems.push(request.system); prompts.push(request.prompt); return answers[systems.length - 1]!; });
  const config = configSchema.parse({ providers: { p: { transport: 'local' } }, profiles: { verify: { provider: 'p', model: 'm', passes: 3 } } });
  const pack = (await loadPack('en')).pack;
  const text = 'That were shorter. He left.'; const b = book(text); const scene = b.chapters[0]!.scenes[0]!;
  const proposal = makeProposal({ chapter: 'one', scene: scene.id, category: 'grammar', target: 'That were', replacement: 'That was', sceneText: text, source: 'model', unverified: true });
  const context = editorialContext(proposal, false, false, configSchema.parse({}));
  assert.deepEqual(context, { location: { inside_quotes_or_dialogue_line: false, paragraph_contains_quotes_or_dialogue_lines: false, narrative_voice: 'unknown' }, edit: { editor_category: 'grammar', category_source: 'editor, self-reported', editor_passes: ['standard'] }, preservation: { configured: false } });
  const result = await verifyMeaning('That were', 'That was', text, 'prose', config, pack, new Cache(os.tmpdir(), true), new Gateway(config, pack, {}, { local }), { necessity: true, context });
  assert.equal(result.passed, false, 'one dissenting pass of three still rejects');
  assert.equal(result.reason, 'unnecessary: recurring idiom');
  assert.equal(systems.length, 2, 'stops at the first rejection');
  assert.match(systems[0]!, /narrative_voice is unknown/);
  assert.match(prompts[0]!, /^CONTEXT:\n\n\{"location":/);
  assert.equal(necessityContextPromptVersion, 'necessity-context-1.0.0');
  assert.deepEqual(editorialContext(proposal, true, true, configSchema.parse({ editorial_profile: { preservation: { dialect: true }, protected_forms: ['x'] } })).preservation,
    { configured: true, historical_orthography: false, period_grammar: false, dialect: true, authorial_repetition: false, protected_forms: 1 });
});

test('CONTEXT: only copy mode with check: necessity and context: true sends context; proofread is unchanged', async () => {
  const original = globalThis.fetch; const bodies: Array<{ messages: Array<{ content: string }> }> = [];
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)); bodies.push(body);
    const content = /BEFORE is objectively incorrect/.test(body.messages[0].content) ? '{"necessary":true,"reason":"typo"}' : '{"necessary":true,"preserved":true,"reason":"typo"}';
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
  }) as typeof fetch;
  try {
    const text = 'He saw teh dog.'; const b = book(text); const scene = b.chapters[0]!.scenes[0]!;
    const proposal = makeProposal({ chapter: 'one', scene: scene.id, category: 'spelling', target: 'teh', replacement: 'the', sceneText: text, source: 'model', unverified: true });
    const loaded = (context: boolean) => ({ config: configSchema.parse({ providers: { p: { transport: 'openai', endpoint: 'https://example.invalid/v1/chat/completions', api_key: 'k' } }, profiles: { verify: { provider: 'p', model: 'm', passes: 1, check: 'necessity', context } } }), winningLayer: {}, warnings: [] });
    const run = async (mode: string, context: boolean) => { bodies.length = 0; await guardProposals({ book: b, stateDir: os.tmpdir() } as never, loaded(context), await loadPack('en'), [proposal], true, mode); return bodies.map((body) => body.messages[1]!.content.startsWith('CONTEXT:')); };
    assert.deepEqual(await run('copy', true), [true]);
    assert.deepEqual(await run('copy', false), [false]);
    assert.deepEqual(await run('proofread', true), [false, false], 'proofread: objective check + meaning, no context');
  } finally { globalThis.fetch = original; }
});
