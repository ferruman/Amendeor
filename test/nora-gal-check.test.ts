import test from 'node:test';
import assert from 'node:assert/strict';
import { splitScenes, type Book } from '../src/book.ts';
import { loadPack } from '../src/lang/pack.ts';
import { checkNoraGal } from '../src/checks/nora-gal.ts';

const asBook = (text: string, lang = 'ru'): Book => ({ lang, chapters: [{ slug: 'one', title: 'Одна', file: 'one.md', text, scenes: splitScenes(text) }] });

test('separate guide check marks narrow office-language signals with exact spans', async () => {
  const text = 'Комиссия осуществляет проверку. В целях обеспечения порядка имело место событие.';
  const findings = checkNoraGal(asBook(text), (await loadPack('ru')).pack);
  assert.deepEqual(findings.map((item) => item.id), ['office.action-noun', 'office.purpose-frame', 'office.empty-existence']);
  for (const item of findings) {
    assert.equal(text.slice(item.start, item.end), item.quote);
    assert.equal(item.guide, 'nora-gal');
    assert.match(item.principle, /^gal\./);
    assert.ok(item.source_pages);
    assert.ok(item.reason);
  }
});

test('guide check skips dialogue and ordinary narrative', async () => {
  const text = '«Он осуществляет проверку», — сказал он.\n— В целях обеспечения порядка.\nОн проверил дверь и вышел.';
  assert.deepEqual(checkNoraGal(asBook(text), (await loadPack('ru')).pack), []);
  assert.deepEqual(checkNoraGal(asBook('She checked the door.', 'en'), (await loadPack('en')).pack), []);
});
