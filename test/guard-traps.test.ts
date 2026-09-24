import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { semanticTrap } from '../src/guard/traps.ts';
import { loadPack } from '../src/lang/pack.ts';
import { sameStem } from '../src/text/names.ts';

for (const [work, lang] of [['jekyll-en', 'en'], ['kashtanka-ru', 'ru']] as const) {
  test(work + ': semantic traps reject at least 95% of meaning changes', async () => {
    const traps = (JSON.parse(await readFile('eval/fixtures/' + work + '/traps.json', 'utf8')) as { traps: Array<{ type: string; before: string; after: string }> }).traps;
    const pack = (await loadPack(lang)).pack;
    const recalled = traps.filter((trap) => semanticTrap(trap.before, trap.after, pack));
    assert.ok(recalled.length / traps.length >= 0.95, recalled.length + '/' + traps.length);
    for (const type of new Set(traps.map((trap) => trap.type))) assert.ok(recalled.some((trap) => trap.type === type));
  });
}

test('mechanical baseline edits do not trigger semantic traps', async () => {
  const en = (await loadPack('en')).pack, ru = (await loadPack('ru')).pack;
  for (const [before, after] of [['again again', 'again'], ['. he', '. He'], ['startling startling', 'startling']]) assert.equal(semanticTrap(before, after, en), null);
  for (const [before, after] of [['Иваныч Иваныч', 'Иваныч'], ['снова снова', 'снова'], ['- К', '— К']]) assert.equal(semanticTrap(before, after, ru), null);
  assert.equal(sameStem('управление', 'управления'), true);
  assert.equal(semanticTrap('управление', 'управления', ru), null);
  assert.equal(semanticTrap("She didn't recognize him.", 'She barely recognized him.', en), 'negation-change');
  assert.equal(semanticTrap('Она остановилась…', 'Она остановилась.', ru), 'ellipsis-change');
  assert.equal(semanticTrap('He paused...', 'He paused.', en), 'ellipsis-change');
  assert.equal(semanticTrap('было светло и шумно', 'было светло, и шумно', ru), 'coordinate-comma-insertion');
  assert.equal(semanticTrap('бросилась на гуся…', 'бросилась на гуся… ', ru), 'trailing-space-only');
  assert.equal(semanticTrap('The large handsome face', 'The large, handsome face', en, { modelGenerated: true }), 'unsupported-comma-change');
  assert.equal(semanticTrap('The large handsome face, and then', 'The large, handsome face, and then', en, { modelGenerated: true }), 'unsupported-comma-change');
  assert.equal(semanticTrap('на матрасике, лежал кот', 'на матрасике лежал кот', ru, { modelGenerated: true }), 'unsupported-comma-change');
  assert.equal(semanticTrap('мочёный горох', 'моченый горох', ru, { modelGenerated: true }), 'yo-normalization');
  assert.equal(semanticTrap('гусь вытянул шею и заговорил', 'гусь, вытянув шею, заговорил', ru, { modelGenerated: true }), 'sequence-to-gerund-change');
  assert.equal(semanticTrap('a fellow; an excellent fellow', 'a fellow, an excellent fellow', en, { modelGenerated: true }), 'punctuation-style-only');
  assert.equal(semanticTrap('The large handsome face', 'The large, handsome face', en), null);
});
