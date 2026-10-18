import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { splitScenes, type Book } from '../src/book.ts';
import { loadPack } from '../src/lang/pack.ts';
import { loadConfig } from '../src/config.ts';
import { habitPatterns, collectUses, judgeDecisions, thinHabits, latestBookRun, type Habit } from '../src/checks/habits.ts';

const prose = 'She came in from the yard and set the basket on the table, and nobody in the kitchen asked her where she had been. ';
const text = [
  `${prose}He squared the pad on the desk. She squared the folder and left.`,
  `${prose}He squared the papers against the edge. Then he squared his shoulders.`,
  `${prose}“I squared it with the bank,” he said. It was plain to everyone, which was the point.`,
].join('\n\n');
const book: Book = { lang: 'en', chapters: [{ slug: 'ch01', title: 'One', file: 'ch01.md', text, scenes: splitScenes(text) }] };
const squared: Habit = { id: 'amendeor:aaaaaaaaaaaa0001', summary: 'Squaring papers recurs as a default gesture.', patterns: ['squared'] };
const plain: Habit = { id: 'amendeor:aaaaaaaaaaaa0002', summary: '"Plain" recurs.', patterns: ['plain'] };

test('habit patterns: the explicit list wins; otherwise the phrases the summary quotes, without ellipses', () => {
  assert.deepEqual(habitPatterns('The “the way…” frame recurs', undefined, undefined), ['the way']);
  assert.deepEqual(habitPatterns('« which meant » revient', undefined, undefined), ['which meant']);
  assert.deepEqual(habitPatterns('anything', undefined, ['Squared', 'square the']), ['squared', 'square the']);
});

test('collect: every sentence with a pattern, once, with its dialogue flag; whole words only', async () => {
  const pack = (await loadPack('en')).pack;
  const uses = collectUses(book, [squared], pack);
  assert.deepEqual(uses.map((u) => u.sentence), ['He squared the pad on the desk.', 'She squared the folder and left.', 'He squared the papers against the edge.', 'Then he squared his shoulders.', '“I squared it with the bank,” he said.']);
  assert.deepEqual(uses.map((u) => u.dialogue), [false, false, false, false, true]);
  for (const u of uses) assert.equal(book.chapters[0]!.scenes.find((s) => s.id === u.scene)!.text.slice(u.start, u.end), u.sentence);
});

test('judge: no new habit, no reused wording, the book\'s language, and never more than two thirds of a habit', async () => {
  const pack = (await loadPack('en')).pack;
  const uses = collectUses(book, [squared, plain], pack);
  const id = (s: string) => uses.find((u) => u.sentence.startsWith(s))!.id;
  const out = JSON.stringify({ decisions: [
    { id: id('He squared the pad'), action: 'replace', replacement: 'He set the pad straight on the desk.', reason: 'thin' },
    { id: id('She squared'), action: 'replace', replacement: 'She set the folder straight and left.', reason: 'same wording again' },
    { id: id('He squared the papers'), action: 'replace', replacement: 'He made the papers plain against the edge.', reason: 'trades one habit for another' },
    { id: id('Then he squared'), action: 'replace', replacement: 'Entonces enderezó los hombros con cuidado delante de todos ellos.', reason: 'wrong language' },
    { id: id('“I squared'), action: 'keep', reason: 'his speech' },
    { id: 'nope', action: 'replace', replacement: 'x' },
  ] });
  const judged = judgeDecisions(out, uses, [squared, plain], book, pack);
  assert.deepEqual(judged.findings.map((f) => f.replacement), ['He set the pad straight on the desk.']);
  assert.ok(judged.discarded.some((d) => /reused/.test(d)));
  assert.ok(judged.discarded.some((d) => /introduces a known habit/.test(d)));
  assert.ok(judged.discarded.some((d) => /language/.test(d)));
  assert.ok(judged.discarded.some((d) => /unknown use id/.test(d)));
  const many = JSON.stringify({ decisions: uses.filter((u) => u.habit === squared.id).map((u, i) => ({ id: u.id, action: 'replace', replacement: u.sentence.replace('squared', ['tidied', 'aligned', 'evened', 'straightened', 'settled'][i]!), reason: 'r' })) });
  assert.equal(judgeDecisions(many, uses, [squared, plain], book, pack).findings.length, Math.floor(5 * 2 / 3), 'thin, never eliminate');
});

// Сквозной путь: прошлый прогон с ляпом и привычкой → прореживание → новый прогон сохраняет ляп и добавляет
// замены → edit делает из них правки только для автора после проверки смысла.
test('habits end to end: the slip survives the new run; thinning becomes meaning-checked, author-only proposals', async () => {
  const { openSource } = await import('../src/source/index.ts');
  const { writeFindingsRun } = await import('../src/checks/findings.ts');
  const { editMechanical } = await import('../src/edit/mechanical.ts');
  const { LocalProvider } = await import('../src/provider/local.ts');
  const root = await mkdtemp(path.join(os.tmpdir(), 'amendeor-habits-'));
  try {
    const file = path.join(root, 'book.md'); await writeFile(file, text + '\n');
    const source = await openSource(file, { lang: 'en', out: path.join(root, 'out') }); source.findingsDir = path.join(root, 'findings');
    const pack = (await loadPack('en')).pack;
    const scene = source.book.chapters[0]!.scenes[0]!; const ch = source.book.chapters[0]!.slug;
    const at = (q: string) => ({ start: scene.text.indexOf(q), end: scene.text.indexOf(q) + q.length });
    const base = { guide: 'book' as const, source_pages: '', chapter: ch, scene: scene.id, provenance: 'whole-book pass', severity: 'low' as const, kind: 'contextual' as const, confidence: 0.7 };
    const slipQuote = 'She came in from the yard and set the basket on the table, and nobody in the kitchen asked her where she had been.';
    await writeFindingsRun(source.findingsDir, root, source.book, [
      { ...base, id: 's', principle: 'book.slip', quote: slipQuote, ...at(slipQuote), reason: 'A slip.', replacement: 'She came in from the yard and set the basket on the table, and no one in the kitchen asked her where she had been.' },
      { ...base, id: 'h', principle: 'book.habit', quote: 'He squared the pad on the desk.', ...at('He squared the pad on the desk.'), reason: 'Squaring recurs.', patterns: ['squared'] },
    ], { guide: 'book', startedAt: new Date().toISOString() });
    const previous = await latestBookRun(source.findingsDir, source.book);
    assert.equal(previous.items.length, 2); assert.deepEqual(previous.habits.map((h) => h.patterns), [['squared']]);
    const loaded = await loadConfig({ env: { HOME: root }, cli: { providers: { local: { transport: 'local', endpoint: path.join(root, 'script.json') } }, profiles: { book: { provider: 'local', model: 'reader' }, verify: { provider: 'local', model: 'verifier', passes: 1 } } } });
    const uses = collectUses(source.book, previous.habits, pack);
    const reader = new LocalProvider(() => JSON.stringify({ decisions: [{ id: uses[0]!.id, action: 'replace', replacement: 'He set the pad straight on the desk.', reason: 'thin' }] }));
    const result = await thinHabits(source.book, pack, loaded, source.stateDir, previous.habits, false, { local: reader });
    assert.equal(result.findings.length, 1); assert.equal(result.requests, 1);
    await writeFindingsRun(source.findingsDir, root, source.book, [...previous.items, ...result.findings], { guide: 'book+habits', startedAt: new Date().toISOString() });
    await writeFile(path.join(root, 'script.json'), JSON.stringify({ responses: { verifier: JSON.stringify({ preserved: true, reason: 'same meaning' }) } }));
    const edit = await editMechanical(source, loaded, await loadPack('en'), { mode: 'mechanical', noCache: true });
    const backed = edit.proposals.filter((p) => p.source_findings?.length);
    assert.deepEqual(backed.map((p) => p.category).sort(), ['prose-pattern', 'word-choice'], 'the slip and the habit fix');
    for (const p of backed) { assert.equal(p.unverified, true); assert.equal(p.impact, 'prose'); }
    const thin = backed.find((p) => p.category === 'prose-pattern')!;
    assert.equal(thin.replacement, 'He set the pad straight on the desk.');
    assert.ok(thin.verification.passes >= 1, 'meaning was checked');
  } finally { await rm(root, { recursive: true, force: true }); }
});

// Замена — только у привычки: подмена фамилии вдали от неё отклоняется, вычеркнутое сравнение до конца клаузы — нет.
test('judge: a replacement stays at the habit and its clause', async () => {
  const pack = (await loadPack('en')).pack;
  const t = `${prose}I proposed Caroline and Tessa Maddox, the way a neighbour would, driving her own car. It was quiet in the way a kitchen is when the kettle has gone off.`;
  const b: Book = { lang: 'en', chapters: [{ slug: 'ch01', title: 'One', file: 'ch01.md', text: t, scenes: splitScenes(t) }] };
  const way: Habit = { id: 'amendeor:aaaaaaaaaaaa0003', summary: 'The "the way…" frame recurs.', patterns: ['the way'] };
  const uses = collectUses(b, [way], pack);
  const [far, near] = uses;
  const out = JSON.stringify({ decisions: [
    { id: far!.id, action: 'replace', replacement: 'I proposed Caroline Maddox and Tessa, as a neighbour would, driving her own car.', reason: 'moves the surname' },
    { id: near!.id, action: 'replace', replacement: 'It was quiet except for the refrigerator.', reason: 'cuts the comparison' },
  ] });
  const judged = judgeDecisions(out, uses, [way], b, pack);
  assert.deepEqual(judged.findings.map((f) => f.replacement), ['It was quiet except for the refrigerator.']);
  assert.ok(judged.discarded.some((d) => /beyond the habit/.test(d)));
});

test('verifier: thinning proposals get the thinning prompt; others keep the strict one byte for byte', async () => {
  const { verifyMeaning } = await import('../src/guard/verify.ts');
  const { verifyPrompt } = await import('../src/prompts/verify.ts');
  const { Gateway } = await import('../src/provider/gateway.ts');
  const { Cache } = await import('../src/cache.ts');
  const { LocalProvider } = await import('../src/provider/local.ts');
  const { configSchema } = await import('../src/config.ts');
  const root = await mkdtemp(path.join(os.tmpdir(), 'amendeor-thin-verify-'));
  try {
    const systems: string[] = [];
    const config = configSchema.parse({ providers: { p: { transport: 'local', endpoint: 'x' } }, profiles: { verify: { provider: 'p', model: 'v', passes: 1 } } });
    const pack = (await loadPack('en')).pack;
    const gateway = new Gateway(config, pack, {}, { local: new LocalProvider((r) => { systems.push(r.system); return JSON.stringify({ preserved: true, reason: 'ok' }); }) });
    await verifyMeaning('a b', 'a c', 'ctx', 'prose', config, pack, new Cache(root, true), gateway, { thinning: true });
    await verifyMeaning('a b', 'a c', 'ctx', 'prose', config, pack, new Cache(root, true), gateway, {});
    assert.match(systems[0]!, /thin a repeated stylistic habit/);
    assert.equal(systems[1], verifyPrompt('a b', 'a c', 'ctx').system);
  } finally { await rm(root, { recursive: true, force: true }); }
});
