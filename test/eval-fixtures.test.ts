import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { openSource } from '../src/source/index.ts';
import { generateMutations, type PreserveSpan } from '../eval/mutate.ts';
import { generateTraps, trapTypes } from '../eval/traps.ts';
import { loadPack } from '../src/lang/pack.ts';
import { scanFormulaicProse } from '../src/patterns/formulaic.ts';

for (const work of ['jekyll-en', 'kashtanka-ru']) {
  test(`${work}: seeded mutations locate and avoid protected text`, async () => {
    const base = `eval/fixtures/${work}`;
    const fixture = JSON.parse(await readFile(`${base}/fixture.json`, 'utf8')) as { control_chapter: string };
    const preserve = JSON.parse(await readFile(`${base}/preserve.json`, 'utf8')) as { spans: PreserveSpan[] };
    const first = await generateMutations(work, 'test-seed');
    const firstBytes = await readFile(`${base}/mutations.json`, 'utf8');
    const source = await openSource(`${base}/mutated`);
    const original = await openSource(`${base}/original`);
    for (const mutation of first) {
      assert.notEqual(mutation.chapter, fixture.control_chapter);
      const scene = source.book.chapters.find((chapter) => chapter.slug === mutation.chapter)?.scenes.find((item) => item.id === mutation.scene);
      assert.ok(scene);
      assert.equal(scene.text.slice(mutation.span.start, mutation.span.end), mutation.mutated);
      assert.ok(!preserve.spans.some((span) => span.chapter === mutation.chapter && span.scene === mutation.scene && mutation.span.start < span.end && mutation.span.end > span.start));
    }
    const control = source.book.chapters.find((chapter) => chapter.slug === fixture.control_chapter);
    const originalControl = original.book.chapters.find((chapter) => chapter.slug === fixture.control_chapter);
    assert.equal(control?.text, originalControl?.text);
    const second = await generateMutations(work, 'test-seed');
    assert.deepEqual(second, first);
    assert.equal(await readFile(`${base}/mutations.json`, 'utf8'), firstBytes);
    await generateMutations(work);
    const formulaic = await generateMutations(work, 'amendeor-v2', true);
    assert.equal(formulaic.filter((mutation) => mutation.type === 'formulaic').length, 1);
    assert.equal(formulaic.find((mutation) => mutation.type === 'formulaic')?.pattern_id, 'formulaic.filler-frame');
    const formulaicSource = await openSource(`${base}/mutated-formulaic`);
    assert.equal(formulaicSource.book.chapters.find((chapter) => chapter.slug === fixture.control_chapter)?.text, originalControl?.text);
    assert.ok(scanFormulaicProse(formulaicSource.book, (await loadPack(formulaicSource.book.lang)).pack).some((hit) => hit.id === 'formulaic.filler-frame'));
    for (const mutation of formulaic) {
      const scene = formulaicSource.book.chapters.find((chapter) => chapter.slug === mutation.chapter)?.scenes.find((item) => item.id === mutation.scene);
      assert.equal(scene?.text.slice(mutation.span.start, mutation.span.end), mutation.mutated);
    }
  });
  test(`${work}: 20 meaning traps per type with half fixture context`, async () => {
    const traps = await generateTraps(work);
    assert.equal(traps.length, 160);
    for (const type of trapTypes) {
      const group = traps.filter((item) => item.type === type);
      assert.equal(group.length, 20);
      assert.equal(group.filter((item) => item.origin === 'fixture').length, 10);
      assert.equal(group.filter((item) => item.origin === 'hand').length, 10);
      assert.ok(group.every((item) => item.before !== item.after));
    }
  });
}
