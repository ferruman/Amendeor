import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { splitScenes, type Book } from '../src/book.ts';
import { loadPack } from '../src/lang/pack.ts';
import { loadConfig } from '../src/config.ts';
import { checkBookPass, toBookPassFindings } from '../src/checks/book-pass.ts';
import { toFindings } from '../src/checks/findings.ts';

const one = 'The word sat in him, four syllables, holding its edge.\n\nHe squared the pad on the desk.';
const two = 'She squared the folder and left.\n\nHe turned three cups on the griddle with a spatula.';
const book: Book = { lang: 'en', chapters: [
  { slug: 'ch01', title: 'One', file: 'ch01.md', text: one, scenes: splitScenes(one) },
  { slug: 'ch02', title: 'Two', file: 'ch02.md', text: two, scenes: splitScenes(two) },
] };

// Проход по всей книге: пометка ляпа несёт правку, привычка — число повторов; цитата, которой нет, отбрасывается;
// два прохода с одинаковыми пометками дают одну находку на место; второй запуск берёт ответы из кэша.
test('book pass: slips carry a fix, habits a count; unquoted marks drop; passes merge; answers are cached', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'amendeor-book-'));
  try {
    const script = path.join(root, 'script.json');
    await writeFile(script, JSON.stringify({ responses: { reader: JSON.stringify({ marks: [
      { kind: 'slip', chapter: 'ch01', quote: 'four syllables', problem: '"Ritual" has three syllables.', fix: 'three syllables' },
      { kind: 'slip', chapter: 'ch01', quote: 'He turned three cups on the griddle with a spatula.', problem: 'Cups cannot be turned on a griddle; pancakes are meant.', fix: 'He turned three pancakes on the griddle with a spatula.' },
      { kind: 'habit', chapter: 'ch01', quote: 'He squared the pad on the desk.', problem: 'Squaring papers recurs as a default gesture.', fix: 'Keep it for Hannah only.', count: 19 },
      { kind: 'slip', chapter: 'ch02', quote: 'A sentence the book never had.', problem: 'Invented.' },
      { kind: 'nonsense', chapter: 'ch02', quote: 'x', problem: '' },
    ] }) } }));
    const loaded = await loadConfig({ env: { HOME: root }, cli: { providers: { local: { transport: 'local', endpoint: script } }, profiles: { book: { provider: 'local', model: 'reader' } } } });
    const pack = (await loadPack('en')).pack;
    const first = await checkBookPass(book, pack, loaded, path.join(root, 'state'), false, 2);
    assert.equal(first.status, 'ok');
    assert.equal(first.ledger.length, 2, 'two passes, two calls');
    assert.deepEqual(first.findings.map((f) => [f.principle, f.chapter, f.quote.slice(0, 14)]), [
      ['book.slip', 'ch01', 'four syllables'], ['book.habit', 'ch01', 'He squared the'], ['book.slip', 'ch02', 'He turned thre']], 'a quote under the wrong chapter is found where it is');
    assert.equal(first.findings[0]!.suggestion, 'three syllables');
    assert.match(first.findings[1]!.reason, /≈19×/);
    assert.equal(first.findings[0]!.severity, 'medium'); assert.equal(first.findings[1]!.severity, 'low');
    for (const f of first.findings) assert.equal(book.chapters.find((c) => c.slug === f.chapter)!.scenes.find((s) => s.id === f.scene)!.text.slice(f.start, f.end), f.quote);
    assert.equal(first.discarded.length, 4, 'the invented quote and the malformed mark, once per pass');
    const [written] = toFindings(book, first.findings, 'run', root);
    assert.equal(written!.category, 'style.book.slip');
    assert.equal((written as { suggestion?: string }).suggestion, 'three syllables');
    const again = await checkBookPass(book, pack, loaded, path.join(root, 'state'), false, 2);
    assert.equal(again.cached, 2); assert.equal(again.ledger.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

// Ляп с исправленной фразой проходит через findings в edit как правка только на решение автора;
// статус wontfix её подавляет; ляп без замены остаётся находкой.
test('book pass → edit: a slip with a replacement becomes an author-only proposal; wontfix suppresses it', async () => {
  const { openSource } = await import('../src/source/index.ts');
  const { editMechanical } = await import('../src/edit/mechanical.ts');
  const { writeFindingsRun } = await import('../src/checks/findings.ts');
  const { readFindings } = await import('../src/findings/intake.ts');
  const root = await mkdtemp(path.join(os.tmpdir(), 'amendeor-book-edit-'));
  try {
    const file = path.join(root, 'book.md');
    await writeFile(file, 'The word sat in him, four syllables, holding its edge.\n\nHe squared the pad on the desk.\n');
    const source = await openSource(file, { lang: 'en', out: path.join(root, 'out') });
    source.findingsDir = path.join(root, 'findings');
    const scene = source.book.chapters[0]!.scenes[0]!;
    const quote = 'The word sat in him, four syllables, holding its edge.';
    const slip = { id: 'x', guide: 'book' as const, kind: 'contextual' as const, principle: 'book.slip', source_pages: '', chapter: source.book.chapters[0]!.slug, scene: scene.id,
      start: scene.text.indexOf(quote), end: scene.text.indexOf(quote) + quote.length, quote, reason: '"Ritual" has three syllables.', provenance: 'whole-book pass', severity: 'medium' as const, confidence: 0.7,
      suggestion: 'Change "four" to "three".', replacement: 'The word sat in him, three syllables, holding its edge.' };
    const plain = { ...slip, quote: 'He squared the pad on the desk.', start: scene.text.indexOf('He squared'), end: scene.text.indexOf('He squared') + 30, replacement: undefined };
    await writeFindingsRun(source.findingsDir, root, source.book, [slip, plain], { guide: 'book', startedAt: new Date().toISOString() });
    const intake = await readFindings(source);
    assert.equal(intake.slips.length, 1, 'only the slip with a replacement');
    const loaded = await loadConfig({ env: { HOME: root }, cli: {} });
    const result = await editMechanical(source, loaded, await loadPack('en'), { mode: 'mechanical', noCache: true });
    const made = result.proposals.filter((p) => p.source_findings?.length);
    assert.equal(made.length, 1);
    assert.equal(made[0]!.target.text, quote);
    assert.equal(made[0]!.replacement, slip.replacement);
    assert.equal(made[0]!.unverified, true); assert.equal(made[0]!.impact, 'prose');
    assert.ok(made[0]!.review?.evidence.finding);
    const findingId = intake.slips[0]!.id;
    await writeFile(path.join(source.findingsDir, '_status.jsonl'), JSON.stringify({ schema: 'codicora.status/0.1', finding_id: findingId, status: 'wontfix', by: 'author', at: '2026-10-18T00:00:00Z' }) + '\n');
    const suppressed = await editMechanical(source, loaded, await loadPack('en'), { mode: 'mechanical', noCache: true });
    assert.equal(suppressed.proposals.filter((p) => p.source_findings?.length).length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

// Тайм-аут профиля доходит до запроса: вся книга с рассуждением не укладывается в 60 с по умолчанию.
test('profile timeout_ms reaches the request; the shipped book profile waits 900 s', async () => {
  const { Gateway } = await import('../src/provider/gateway.ts');
  const { configSchema } = await import('../src/config.ts');
  const { parse } = await import('yaml');
  const { readFile } = await import('node:fs/promises');
  const shipped = configSchema.parse(parse(await readFile(new URL('../amendeor.yaml', import.meta.url), 'utf8')));
  assert.equal(shipped.profiles.book!.timeout_ms, 900_000);
  const seen: Array<number | undefined> = [];
  const transport = { complete: async (request: { timeoutMs?: number }) => { seen.push(request.timeoutMs); return { text: '{}', finishReason: 'stop', usage: { input_tokens: 1, output_tokens: 1 }, ms: 1 }; } };
  const config = configSchema.parse({ providers: { p: { transport: 'local', endpoint: 'x' } }, profiles: { book: { provider: 'p', model: 'm', timeout_ms: 900_000 }, edit: { provider: 'p', model: 'm' } } });
  const gateway = new Gateway(config, (await loadPack('en')).pack, {}, { local: transport as never });
  await gateway.complete('s', 'book', 'sys', 'user', 10); await gateway.complete('s', 'edit', 'sys', 'user', 10);
  assert.deepEqual(seen, [900_000, undefined]);
});

// Пометки не на языке книги: один повтор с замечанием; упорно чужой ответ остаётся, помечается в кэше
// и не переспрашивается при следующем запуске.
test('book pass: marks in another language are asked again once; a stubborn answer is kept and not re-asked', async () => {
  const { LocalProvider } = await import('../src/provider/local.ts');
  const root = await mkdtemp(path.join(os.tmpdir(), 'amendeor-book-lang-'));
  try {
    const prose = 'The word sat in him for the whole of the evening, and he did not say it to anyone who came to the door. '.repeat(30);
    const text = `${prose}\n\nThe word sat in him, four syllables, holding its edge.`;
    const englishBook: Book = { lang: 'en', chapters: [{ slug: 'ch01', title: 'One', file: 'ch01.md', text, scenes: splitScenes(text) }] };
    const mark = (problem: string) => JSON.stringify({ marks: [{ kind: 'slip', chapter: 'ch01', quote: 'four syllables', problem, fix: problem }] });
    const french = mark('Le mot « ritual » ne compte que trois syllabes, et la phrase donne un nombre faux au lecteur attentif.');
    const english = mark('The word "ritual" has three syllables, so the sentence gives the attentive reader a wrong count.');
    const loaded = await loadConfig({ env: { HOME: root }, cli: { providers: { local: { transport: 'local', endpoint: 'none' } }, profiles: { book: { provider: 'local', model: 'reader' } } } });
    const pack = (await loadPack('en')).pack;
    let calls = 0;
    const fixes = new LocalProvider((request) => { calls++; return request.system.includes('another language') ? english : french; });
    const fixed = await checkBookPass(englishBook, pack, loaded, path.join(root, 'a'), false, 1, { local: fixes });
    assert.equal(calls, 2); assert.match(fixed.findings[0]!.reason, /three syllables/);
    calls = 0;
    const stubborn = new LocalProvider(() => { calls++; return french; });
    const kept = await checkBookPass(englishBook, pack, loaded, path.join(root, 'b'), false, 1, { local: stubborn });
    assert.equal(calls, 2); assert.equal(kept.findings.length, 1, 'kept rather than lost');
    assert.ok(kept.discarded.some((d) => /still not in the manuscript's language/.test(d.reason)));
    calls = 0;
    const warm = await checkBookPass(englishBook, pack, loaded, path.join(root, 'b'), false, 1, { local: stubborn });
    assert.equal(calls, 0); assert.equal(warm.cached, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

// Цитата в кавычках, которых в тексте нет, всё равно находится; находка и замена несут текст без кавычек.
test('book pass: a quote wrapped in outer quotation marks is still located', () => {
  const { findings, discarded } = toBookPassFindings(book, JSON.stringify({ marks: [
    { kind: 'slip', chapter: 'ch02', quote: '“He turned three cups on the griddle with a spatula.”', problem: 'Pancakes are meant.', replacement: '"He turned three pancakes on the griddle with a spatula."' },
    { kind: 'slip', chapter: 'ch01', quote: '"""', problem: 'Nothing.' },
  ] }));
  assert.equal(discarded.length, 1);
  const [f] = findings;
  assert.equal(f.quote, 'He turned three cups on the griddle with a spatula.');
  assert.equal(two.slice(f.start, f.end), f.quote);
  assert.equal(f.replacement, 'He turned three pancakes on the griddle with a spatula.');
});

// Число привычки — буквальный счёт по шаблонам, перекрытия — одно вхождение; без шаблонов остаётся оценка модели.
test('book pass: a habit with patterns carries its literal count, not the model estimate', () => {
  const { findings } = toBookPassFindings(book, JSON.stringify({ marks: [
    { kind: 'habit', chapter: 'ch01', quote: 'He squared the pad on the desk.', problem: 'Squaring recurs.', count: 19, patterns: ['squared', 'squared the'] },
    { kind: 'habit', chapter: 'ch02', quote: 'She squared the folder and left.', problem: 'Squaring recurs.', count: 7 },
  ] }));
  assert.equal(findings[0]!.reason, 'Squaring recurs. (2× by its patterns)');
  assert.equal(findings[1]!.reason, 'Squaring recurs. (≈7×)');
});
