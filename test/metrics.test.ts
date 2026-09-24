import test from 'node:test';
import assert from 'node:assert/strict';
import { splitScenes, type Book } from '../src/book.ts';
import { loadPack } from '../src/lang/pack.ts';
import { computeMetrics } from '../src/metrics/index.ts';

function book(texts: string[], lang: string): Book {
  return { lang, chapters: texts.map((text, index) => ({ slug: `ch-${index}`, title: `Chapter ${index}`, file: `ch-${index}.md`, text, scenes: splitScenes(text) })) };
}

test('a Russian dash-heavy scene is ordinary against a Russian dash-heavy book', async () => {
  const text = 'Он сказал — это верно. Она ответила — да. Ветер шумел — и ночь пришла.';
  const report = computeMetrics(book([text, text, text, text], 'ru'), (await loadPack('ru')).pack);
  assert.equal(report.hotspots.filter((item) => item.metric === 'dash-density').length, 0);
  assert.equal('adverbs' in report.baseline, false);
});

test('a repeated content phrase needs both the book baseline and an absolute floor', async () => {
  const ordinary = 'The river crossed the field. The morning brought clear light.';
  const repeated = 'The silver bell echoed. The silver bell echoed. The silver bell echoed. The silver bell echoed.';
  const report = computeMetrics(book([ordinary, ordinary, ordinary, repeated], 'en'), (await loadPack('en')).pack);
  assert.ok(report.hotspots.some((item) => item.chapter === 'ch-3' && item.metric === 'ngram-repeats'));
  assert.ok(report.hotspots.every((item) => item.value >= item.floor && item.value > item.baseline));
});
