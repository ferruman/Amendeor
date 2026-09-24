import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPack } from '../src/lang/pack.ts';
import { segmentText, words } from '../src/text/segment.ts';
import { sameStem, properNouns } from '../src/text/names.ts';
import { dialogueSpans } from '../src/text/dialogue.ts';
import { splitScenes } from '../src/book.ts';

test('language packs cover English and Russian, with no invented Russian adverb suffix', async () => {
  const en = await loadPack('en'); const ru = await loadPack('ru-RU');
  assert.equal(en.status, 'loaded'); assert.equal(ru.status, 'loaded');
  assert.deepEqual(ru.pack.adverb_suffixes, []);
  assert.ok(ru.pack.stopwords.length > 0);
});

test('a missing pack is visible and derives a nonempty stopword filter', async () => {
  const result = await loadPack('zz', 'one one one small small word');
  assert.equal(result.status, 'derived');
  assert.match(result.warning!, /missing/);
  assert.ok(result.pack.stopwords.length > 0);
});

test('tokenizer keeps timestamps, dates and decimals whole with raw offsets', async () => {
  const text = 'At 10:14 on 12.09.2026, the value was 3.14.';
  const tokens = words(text);
  assert.ok(tokens.some((token) => token.text === '10:14'));
  assert.ok(tokens.some((token) => token.text === '12.09.2026'));
  assert.ok(tokens.some((token) => token.text === '3.14'));
  for (const token of tokens) assert.equal(text.slice(token.start, token.end), token.text);
  const segmented = segmentText('Dr. Smith arrived. Then he left.', (await loadPack('en')).pack);
  assert.equal(segmented.sentences.length, 2);
});

test('book-wide names ignore sentence openings and shared Russian stems handle declension', async () => {
  const pack = (await loadPack('ru')).pack;
  const text = 'Он увидел Управление. Она ждала у Управления.';
  const book = { lang: 'ru', chapters: [{ slug: 'one', title: 'One', file: 'one.md', text, scenes: splitScenes(text) }] };
  const names = properNouns(book, pack);
  assert.ok(names.has('Управление'));
  assert.ok(sameStem('Управление', 'Управления'));
  assert.equal(sameStem('Кольцевая', 'кольца'), false);
});

test('dialogue includes Russian dash-led speech and paired quotation marks', async () => {
  const pack = (await loadPack('ru')).pack;
  const text = '— Привет, Иван.\nОн ответил: «Здравствуй».';
  const spans = dialogueSpans(text, pack);
  assert.ok(spans.some((span) => span.text.includes('Привет')));
  assert.ok(spans.some((span) => span.text.includes('Здравствуй')));
});
