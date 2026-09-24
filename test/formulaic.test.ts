import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitScenes, type Book } from '../src/book.ts';
import { loadPack } from '../src/lang/pack.ts';
import { scanFormulaicProse } from '../src/patterns/formulaic.ts';

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const asBook = (text: string, lang: string): Book => ({ lang, chapters: [{ slug: 'one', title: 'One', file: 'one.md', text, scenes: splitScenes(text) }] });

test('formulaic examples flag the intended phrase and keep dialogue and clean prose', async () => {
  const examples = JSON.parse(await readFile(path.join(fixtureDir, 'formulaic-examples.json'), 'utf8')) as Array<{ lang: string; verdict: 'flag' | 'keep'; id?: string; text: string }>;
  for (const example of examples) {
    const hits = scanFormulaicProse(asBook(example.text, example.lang), (await loadPack(example.lang)).pack);
    if (example.verdict === 'keep') assert.equal(hits.length, 0, example.text);
    else {
      assert.equal(hits.length, 1, example.text);
      assert.equal(hits[0]!.id, example.id);
      assert.equal(example.text.slice(hits[0]!.start, hits[0]!.end), hits[0]!.quote);
    }
  }
});

test('clean English and Russian control texts have no formulaic hits', async () => {
  for (const lang of ['en', 'ru']) {
    const text = await readFile(path.join(fixtureDir, `control-${lang}.md`), 'utf8');
    assert.deepEqual(scanFormulaicProse(asBook(text, lang), (await loadPack(lang)).pack), []);
  }
});
