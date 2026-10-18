// Ложные правки правил на The Shepherd's Silence: все 44 правки двух правил были ложными.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPack } from '../src/lang/pack.ts';
import { capitalization } from '../src/rules/capitalization.ts';
import { nameVariant } from '../src/rules/name-variant.ts';

test('name-variant: a plural or a possessive-style final letter is the same word, a one-letter swap still is reported', async () => {
  const { pack } = await loadPack('en', '');
  const names = new Map([['Sunday', 12], ['Sundays', 3], ['Wednesday', 7], ['Wednesdays', 2], ['Fowler', 4], ['Fowlers', 1], ['Henderson', 3], ['Hendersons', 1], ['Mary', 2], ['Mark', 1]]);
  const ctx = { pack, config: {}, names } as any;
  const targets = (text: string) => nameVariant.detect({ text } as any, ctx).map((d) => d.target);
  assert.deepEqual(targets('On Sundays and Wednesdays the Fowlers came, and the Hendersons once.'), []);
  assert.deepEqual(targets('Henderson waited for Sunday.'), []);
  assert.deepEqual(targets('Mark said nothing.'), ['Mark'], 'Mark/Mary is still a pair to review');
});

test('sentence-start: initials after markup, units after numbers and deliberately lowercase texts stay as written', async () => {
  const { pack } = await loadPack('en', '');
  const ctx = { pack, config: { preserve: [] } } as any;
  for (const text of ['The thyme was *T. vulgaris* and nothing else.', 'She bought 2 pk. bath salts.', 'got it. free till 2', 'ok. see you sunday', 'The reply came before she put the phone away: got it. free till 2.', 'Alicia wrote back: *tacos on a Monday. you are lucky.*']) assert.deepEqual(capitalization.detect({ text } as any, ctx), [], text);
  assert.equal(capitalization.detect({ text: 'She left. then she came back.' } as any, ctx).length, 1, 'a real lowercase opening after a capitalized sentence is still caught');
});
