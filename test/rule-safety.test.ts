import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { loadConfig } from '../src/config.ts';
import { loadPack } from '../src/lang/pack.ts';
import { openSource } from '../src/source/index.ts';
import { editMechanical } from '../src/edit/mechanical.ts';
import { acceptProposals } from '../src/edited/decisions.ts';
import { buildEdited } from '../src/edited/build.ts';
import { rules } from '../src/rules/index.ts';
import { mergePasses, type Placed } from '../src/edit/merge.ts';
import { makeProposal } from '../src/proposal/identity.ts';
import { deterministicGuard } from '../src/guard/index.ts';
import { configSchema } from '../src/config.ts';
import { splitScenes, type Book } from '../src/book.ts';
import type { Proposal } from '../src/proposal/schema.ts';

// Полномочия детерминированных правил и доказуемо одинаковые правки при слиянии (2026-10-11, rule safety).

// Настоящий путь editMechanical (только правила): предложения, текст после автопринятия mechanical и после «принять всё».
async function run(text: string, lang: string, config: Record<string, unknown> = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'amendeor-rule-safety-'));
  try {
    const manuscript = path.join(dir, 'book.md');
    await writeFile(manuscript, text);
    const source = await openSource(manuscript, { lang, out: path.join(dir, 'out') });
    const loaded = await loadConfig({ env: { HOME: dir }, cli: { ...config, auto_accept: ['mechanical'] } });
    const result = await editMechanical(source, loaded, await loadPack(lang), { mode: 'mechanical', noCache: true, acceptAs: async () => ({ acceptedBy: 'human:cli' }) });
    const auto = await readFile(path.join(source.editedDir, 'chapters/book.md'), 'utf8').catch(() => text);
    // «Принять всё, что можно принять без явного согласия на непроверенное» — так делает человек кнопкой и стенд.
    const acceptable = result.proposals.filter((proposal) => !proposal.unverified);
    const accepted = await acceptProposals(source.editedDir, acceptable, { acceptedBy: 'human:cli' });
    await buildEdited({ book: source.book, editedDir: source.editedDir, accepted, manifestText: source.manifestText });
    const all = await readFile(path.join(source.editedDir, 'chapters/book.md'), 'utf8').catch(() => text);
    let refused = '';
    const review = result.proposals.filter((proposal) => proposal.unverified);
    if (review.length) await acceptProposals(path.join(dir, 'other-edited'), review, { acceptedBy: 'human:cli' }).catch((error: Error) => { refused = error.message; });
    return { proposals: result.proposals, auto, all, refused, rulesStage: (result.run.stages as Array<Record<string, unknown>>)[0]! };
  } finally { await rm(dir, { recursive: true, force: true }); }
}
const named = (proposals: Proposal[], target: string) => proposals.filter((proposal) => proposal.source === 'rule:terminology.name-variant' && proposal.target.text === target);
function assertReviewOnly(proposal: Proposal | undefined, candidate: string) {
  assert.ok(proposal, 'the suspicious variant is still reported');
  assert.equal(proposal!.rule_authority, 'semantic'); assert.equal(proposal!.unverified, true); assert.equal(proposal!.impact, 'prose');
  assert.equal(proposal!.replacement, candidate, 'both spellings are recorded: target and candidate');
  assert.ok(proposal!.review && Object.keys(proposal!.review.evidence).length > 0, 'the evidence that triggered the finding is recorded');
}

test('NAME 1: Mark / Mary — the Twain sentence is reported for review and never applied', async () => {
  const text = 'That book was made by Mr. Mark Twain, and he told the truth, mainly. I never seen anybody but lied one time or another, without it was Aunt Polly, or maybe Mary. Aunt Polly and Mary is all told about in that book.\n';
  const result = await run(text, 'en');
  const [mark] = named(result.proposals, 'Mark');
  assertReviewOnly(mark, 'Mary');
  assert.deepEqual(mark!.review!.evidence, { basis: 'one-letter difference and book frequency', spelling: 'Mark', spelling_count: 1, candidate: 'Mary', candidate_count: 2 });
  assert.match(result.auto, /Mr\. Mark Twain/, 'auto_accept: mechanical does not apply it');
  assert.match(result.all, /Mr\. Mark Twain/, 'accepting every acceptable proposal does not apply it');
  assert.match(result.refused, /unverified-proposal/, 'acceptance needs the explicit unverified consent');
});

test('NAME 2–4: John / Joan, Anna / Anya and Mara / Maro are distinct people until the author says otherwise', async () => {
  // John / Joan и Anna / Anya расходятся не в последней букве: эвристика их даже не сравнивает; Mara / Maro — находка.
  const john = await run('Then John came home. Then Joan smiled. Later Joan left.\n', 'en');
  assert.match(john.all, /John came home/); assert.ok(named(john.proposals, 'John').every((proposal) => proposal.unverified));
  const maro = await run('He saw Mara. They called Mara. He saw Maro.\n', 'en');
  assertReviewOnly(named(maro.proposals, 'Maro')[0], 'Mara');
  assert.match(maro.all, /He saw Maro\./);
  const anya = await run('Then Anna sang. Then Anna laughed. Then Anya listened.\n', 'en');
  assert.match(anya.all, /Anya listened/); assert.ok(named(anya.proposals, 'Anya').every((proposal) => proposal.unverified));
});

test('NAME 5: a typo in a common noun is not a name variant; mechanical corrections in the same text still apply', async () => {
  const result = await run('The dorr was  open. Then Mark came in. Then Mary waited. Then Mary sat.\n', 'en');
  assert.equal(result.proposals.filter((proposal) => proposal.target.text.includes('dorr') && proposal.source === 'rule:terminology.name-variant').length, 0);
  assert.match(result.auto, /was open\./, 'the whitespace rule is still auto-applied');
  assert.match(result.auto, /Mark came in/);
});

test('NAME 6: an explicit canonical-name mapping is an ordinary proposal; ambiguity and canon both fail closed', async () => {
  const text = 'He saw Mara. They called Mara. He saw Maro.\n';
  const mapped = await run(text, 'en', { editorial_profile: { canonical_names: [{ name: 'Mara', variants: ['Maro'] }] } });
  const [maro] = named(mapped.proposals, 'Maro');
  assert.equal(maro!.rule_authority, 'contextual'); assert.equal(maro!.unverified, undefined); assert.equal(maro!.impact, 'prose');
  assert.equal(maro!.replacement, 'Mara'); assert.equal(maro!.review, undefined);
  assert.match(mapped.auto, /saw Maro/, 'not bulk-applied even when authorized');
  assert.match(mapped.all, /He saw Mara\.\n$/, 'applied when the author accepts it');
  const ambiguous = await run(text, 'en', { editorial_profile: { canonical_names: [{ name: 'Mara', variants: ['Maro'] }, { name: 'Mary', variants: ['Maro'] }] } });
  assertReviewOnly(named(ambiguous.proposals, 'Maro')[0], 'Mara');
  const canon = await run('Mr. Mark Twain wrote it. Mary read it. Mary kept it.\n', 'en', { editorial_profile: { canonical_names: [{ name: 'Mark', variants: ['Marc'] }] } });
  assert.equal(named(canon.proposals, 'Mark').length, 0, 'a canonical name is never a heuristic variant of another name');
});

test('NAME 7: a protected proper name is neither changed nor reported', async () => {
  const result = await run('Mr. Mark Twain wrote it. Mary read it. Mary kept it.\n', 'en', { editorial_profile: { protected_forms: ['Mark Twain'] } });
  assert.equal(named(result.proposals, 'Mark').length, 0);
  assert.match(result.all, /Mark Twain/);
});

test('NAME 8–9: names in dialogue and in quotations are reported for review only', async () => {
  for (const text of ['"Mark said so," Mary told him. Mary nodded.\n', 'He wrote: “Mark Twain told the truth.” Mary agreed. Mary left.\n', '— Марк сказал, — ответила Мария. Мария кивнула.\n']) {
    const lang = /[а-я]/i.test(text) ? 'ru' : 'en';
    const result = await run(text, lang);
    const target = lang === 'ru' ? 'Марк' : 'Mark';
    for (const proposal of named(result.proposals, target)) assertReviewOnly(proposal, proposal.replacement);
    assert.ok(result.all.includes(target), `${target} survives in ${JSON.stringify(text)}`);
  }
});

test('NAME 10: occurrences with different frequencies — each rarer spelling is reported with its counts, the frequent one never', async () => {
  const result = await run('Then Maro came. Then Mara came. Then Maro sat. Then Mara sat. Then Mara left.\n', 'en');
  const maro = named(result.proposals, 'Maro');
  assert.equal(maro.length, 2);
  for (const proposal of maro) { assertReviewOnly(proposal, 'Mara'); assert.equal(proposal.review!.evidence.spelling_count, 2); assert.equal(proposal.review!.evidence.candidate_count, 3); }
  assert.equal(named(result.proposals, 'Mara').length, 0);
  assert.equal((result.all.match(/Maro/g) ?? []).length, 2);
});

test('AUTHORITY: every rule declares its class; only mechanical rule output may be bulk- or auto-accepted', async () => {
  const classes = Object.fromEntries(rules.map((rule) => [rule.id, rule.authority]));
  assert.deepEqual(classes, {
    'repetition.doubled-word': 'contextual', 'typography.whitespace': 'mechanical', 'punctuation.balance': 'contextual', 'typography.quotes': 'mechanical',
    'typography.mixed-quotes': 'mechanical', 'typography.dashes-ellipsis': 'mechanical', 'capitalization.sentence-start': 'contextual', 'markdown.stray-marker': 'mechanical',
    'consistency.spelling-variant': 'contextual', 'consistency.region-variant': 'contextual', 'terminology.name-variant': 'semantic', 'grammar.ru-sutki-numeral': 'contextual', 'grammar.ru-pronoun-byl': 'contextual'
  });
  const result = await run('The  cat said said yes. then she left.\n', 'en');
  const by = (id: string) => result.proposals.find((proposal) => proposal.source === `rule:${id}`)!;
  assert.equal(by('typography.whitespace').impact, 'mechanical'); assert.equal(by('typography.whitespace').rule_authority, 'mechanical');
  for (const id of ['repetition.doubled-word', 'capitalization.sentence-start']) { assert.equal(by(id).impact, 'prose', id); assert.equal(by(id).rule_authority, 'contextual', id); }
  assert.equal(result.auto, 'The cat said said yes. then she left.\n', 'auto_accept applies only the mechanical whitespace fix');
  assert.equal(result.all, 'The cat said yes. Then she left.\n', 'contextual fixes still apply when accepted');
});

test('AUTHORITY: dash and ellipsis drafts are classified one by one', async () => {
  const result = await run('- Item one\nWait.. then go - now... fine.\n', 'en', { normalize: { ellipsis: true } });
  const find = (target: string) => result.proposals.find((proposal) => proposal.source === 'rule:typography.dashes-ellipsis' && proposal.target.text === target)!;
  assert.equal(find('- Item').rule_authority, 'contextual', 'a line-start hyphen may be a Markdown list');
  assert.equal(find('Wait..').rule_authority, 'contextual');
  assert.equal(find('go - now').rule_authority, 'mechanical');
  assert.equal(find('...').rule_authority, 'mechanical', 'configured ellipsis');
});

test('AUTHORITY: Russian grammar rules stay silent on correct constructions they used to break', async () => {
  const byl = await run('Он было начал говорить, но замолчал. Они было собрались уходить. Она был дома.\n', 'ru');
  const pronoun = byl.proposals.filter((proposal) => proposal.source === 'rule:grammar.ru-pronoun-byl');
  assert.deepEqual(pronoun.map((proposal) => proposal.target.text), ['Она был'], 'the particle «было» is left alone');
  const sutki = await run('Прошло двадцать два суток. Сто три суток в пути. Прошли два суток.\n', 'ru');
  assert.deepEqual(sutki.proposals.filter((proposal) => proposal.source === 'rule:grammar.ru-sutki-numeral').map((proposal) => proposal.target.text), ['два суток']);
});

test('AUTHORITY: е→ё is review-only (все ≠ всё), ё→е and configured spelling are mechanical', async () => {
  const yo = await run('Всё было тихо. Все пришли.\n', 'ru', { normalize: { yo: 'yo' } });
  const all = yo.proposals.find((proposal) => proposal.target.text === 'Все')!;
  assertReviewOnly(all, 'Всё');
  assert.match(yo.all, /Все пришли/);
  const e = await run('Всё было тихо. Все пришли.\n', 'ru', { normalize: { yo: 'e' } });
  assert.equal(e.proposals.find((proposal) => proposal.target.text === 'Всё')!.rule_authority, 'mechanical');
  const forced = await run('The colour was odd.\n', 'en', { normalize: { spelling: 'american' } });
  assert.equal(forced.proposals.find((proposal) => proposal.target.text === 'colour')!.rule_authority, 'mechanical');
  const counted = await run('The colour, the color, the color.\n', 'en');
  assert.equal(counted.proposals.find((proposal) => proposal.target.text === 'colour')!.rule_authority, 'contextual');
});

// Слияние: одна правка — только если каждая, применённая отдельно, даёт побайтно одинаковую сцену.
const book = (text: string): Book => ({ lang: 'en', chapters: [{ slug: 'one', title: 'One', file: 'one.md', text, scenes: splitScenes(text) }] });
function placedAt(text: string, start: number, target: string, replacement: string, pass: 'standard' | 'diagnostic', category: Proposal['category'] = 'spelling'): Placed {
  assert.equal(text.slice(start, start + target.length), target);
  const scene = splitScenes(text)[0]!;
  return { pass, start, proposal: makeProposal({ chapter: 'one', scene: scene.id, category, target, replacement, sceneText: text, occurrence: text.slice(0, start).split(target).length - 1, source: 'model', unverified: true }) };
}
const at = (text: string, target: string, nth = 0) => { let start = -1; for (let i = 0; i <= nth; i++) start = text.indexOf(target, start + 1); return start; };
const apply = (text: string, proposal: Proposal, start: number) => text.slice(0, start) + proposal.replacement + text.slice(start + proposal.target.text.length);

test('MERGE: different target boundaries with the same resulting scene merge, with the reason recorded', () => {
  const text = 'В современном мире Спустя часа полтора, Иона сидит.';
  const a = placedAt(text, 0, 'В современном мире ', '', 'standard', 'redundancy');
  const b = placedAt(text, 0, 'В современном мире Спустя', 'Спустя', 'diagnostic', 'redundancy');
  const result = mergePasses(text, [a, b]);
  assert.equal(result.proposals.length, 1); assert.equal(result.conflicts.length, 0);
  assert.deepEqual(result.proposals[0]!.passes, ['standard', 'diagnostic']);
  assert.equal(result.merges.length, 1); assert.match(result.merges[0]!.reason, /byte-identical/);
  assert.deepEqual(result.merges[0]!.merged_ids, [a.proposal.id, b.proposal.id].sort());
  assert.equal(apply(text, a.proposal, a.start), apply(text, b.proposal, b.start));
});

test('MERGE: whitespace, capitalization, punctuation and deletion-vs-substitution differences stay deferred', () => {
  const cases: Array<[string, [string, string], [string, string]]> = [
    ['В современном мире Спустя часа полтора, Иона сидит.', ['В современном мире ', ''], ['В современном мире', '']],
    ['and he wrote. he wrote nothing', ['and he wrote. he wrote nothing', 'and he wrote nothing'], ['he wrote. he wrote nothing', 'he wrote. He wrote nothing']],
    ['She left. then she came back.', ['. then', '. Then'], ['. then', '; then']],
    ['She left, and came back.', ['left, and', 'left and'], ['left, and', 'left, then']],
    ['He saw the the dog.', ['the the', 'the'], ['the the', 'a']]
  ];
  for (const [text, [t1, r1], [t2, r2]] of cases) {
    const a = placedAt(text, at(text, t1), t1, r1, 'standard', 'grammar'), b = placedAt(text, at(text, t2), t2, r2, 'diagnostic', 'grammar');
    assert.notEqual(apply(text, a.proposal, a.start), apply(text, b.proposal, b.start));
    const result = mergePasses(text, [a, b]);
    assert.equal(result.proposals.length, 0, `${t1} / ${t2} is deferred`); assert.equal(result.conflicts.length, 1);
    assert.match(result.conflicts[0]!.reason, /different scene text/);
  }
});

test('MERGE: multiple changes in one replacement merge only with an identical result; repeated substrings are proven by result', () => {
  const text = 'teh cat and teh dog';
  const whole = placedAt(text, 0, 'teh cat and teh', 'the cat and the', 'standard');
  const same = placedAt(text, 0, 'teh cat and teh dog', 'the cat and the dog', 'diagnostic');
  assert.equal(mergePasses(text, [whole, same]).proposals.length, 1);
  const partial = placedAt(text, 0, 'teh', 'the', 'diagnostic');
  assert.equal(mergePasses(text, [whole, partial]).conflicts.length, 1, 'fixing one of two typos is a different result');
  // «aaa» → «aa»: удалить первую или вторую «a» — один и тот же итог, хотя смещения разные.
  const triple = 'He said aaa loudly.';
  const first = placedAt(triple, at(triple, 'aaa'), 'aaa', 'aa', 'standard'), second = placedAt(triple, at(triple, 'aaa'), 'aaa loudly', 'aa loudly', 'diagnostic');
  assert.equal(mergePasses(triple, [first, second]).proposals.length, 1);
});

test('MERGE: empty passes, adjacency and provenance', () => {
  const text = 'He saw teh dog near teh gate.';
  const only = [placedAt(text, at(text, 'teh'), 'teh', 'the', 'diagnostic')];
  assert.deepEqual(mergePasses(text, only).proposals.map((proposal) => proposal.passes), [['diagnostic']], 'empty standard pass');
  assert.deepEqual(mergePasses(text, [{ ...only[0]!, pass: 'standard' }]).proposals.map((proposal) => proposal.passes), [['standard']], 'empty diagnostic pass');
  assert.deepEqual(mergePasses(text, []), { proposals: [], conflicts: [], merges: [], merged: 0 });
  const adjacent = mergePasses(text, [placedAt(text, at(text, 'teh'), 'teh', 'the', 'standard'), placedAt(text, at(text, 'dog'), 'dog', 'hound', 'diagnostic')]);
  assert.equal(adjacent.proposals.length, 2, 'adjacent, non-overlapping edits from different passes are both kept');
  assert.deepEqual(adjacent.proposals.map((proposal) => proposal.passes), [['standard'], ['diagnostic']]);
});

test('MERGE: randomized — output is order-independent, merged edits have identical results, kept edits from different passes never overlap', () => {
  let seed = 7; const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const text = 'teh cat saw teh dog and the the bird near a gate gate today.';
  const words = [...text.matchAll(/\S+/g)].map((match) => ({ start: match.index!, word: match[0] }));
  for (let round = 0; round < 300; round++) {
    const items: Placed[] = [];
    for (let i = 0, n = 1 + Math.floor(random() * 6); i < n; i++) {
      const from = Math.floor(random() * words.length), span = Math.min(words.length - from, 1 + Math.floor(random() * 2));
      const start = words[from]!.start, end = words[from + span - 1]!.start + words[from + span - 1]!.word.length;
      const target = text.slice(start, end);
      const replacement = [target.replace('teh', 'the'), target.replace(/(\w+) \1/, '$1'), target.toUpperCase(), target + ' x'][Math.floor(random() * 4)]!;
      if (replacement === target) continue;
      items.push(placedAt(text, start, target, replacement, random() < 0.5 ? 'standard' : 'diagnostic'));
    }
    const forward = mergePasses(text, items), backward = mergePasses(text, [...items].reverse());
    assert.deepEqual(forward.proposals.map((proposal) => [proposal.id, proposal.passes]), backward.proposals.map((proposal) => [proposal.id, proposal.passes]));
    for (const merge of forward.merges) {
      const results = new Set(items.filter((item) => merge.merged_ids.includes(item.proposal.id)).map((item) => apply(text, item.proposal, item.start)));
      assert.equal(results.size, 1, 'merged edits produce one scene text');
    }
    const kept = forward.proposals.map((proposal) => items.find((item) => item.proposal.id === proposal.id)!);
    for (const a of kept) for (const b of kept) if (a !== b && a.proposal.passes?.join() !== b.proposal.passes?.join() && (a.proposal.passes!.length === 1 && b.proposal.passes!.length === 1))
      assert.ok(a.start + a.proposal.target.text.length < b.start || b.start + b.proposal.target.text.length < a.start, 'no overlapping edits from different passes survive');
  }
});

test('MERGE: a merged proposal still meets every deterministic guard (protected form, dialogue, proper name, rule preference)', async () => {
  const pack = (await loadPack('en')).pack;
  const text = '"Mark Twain was here," she said. He saw the the dog.';
  const config = configSchema.parse({ editorial_profile: { protected_forms: ['Twain'] } });
  const merged = mergePasses(text, [placedAt(text, at(text, 'Twain'), 'Twain', 'Twian', 'standard'), placedAt(text, at(text, 'Mark Twain'), 'Mark Twain', 'Mark Twian', 'diagnostic')]);
  assert.equal(merged.proposals.length, 1);
  assert.equal((deterministicGuard(merged.proposals[0]!, text, book(text), pack, config) as { reason: string }).reason, 'protected-form');
  const dialogue = mergePasses(text, [placedAt(text, at(text, 'was here'), 'was here', 'is here', 'standard', 'grammar'), placedAt(text, at(text, 'was'), 'was', 'is', 'diagnostic', 'grammar')]);
  assert.equal(dialogue.proposals.length, 1);
  assert.ok('guard' in deterministicGuard(dialogue.proposals[0]!, text, book(text), pack, configSchema.parse({})), 'a dialogue content change is still refused');
});
