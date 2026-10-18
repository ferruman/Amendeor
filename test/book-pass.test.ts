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
