import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { splitScenes, type Book } from '../src/book.ts';
import { loadPack } from '../src/lang/pack.ts';
import { loadConfig } from '../src/config.ts';
import { checkBookPass } from '../src/checks/book-pass.ts';
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
