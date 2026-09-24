import test from 'node:test';
import assert from 'node:assert/strict';
import { makeProposal } from '../src/proposal/identity.ts';
import { locate } from '../src/proposal/locate.ts';

const base = { category: 'redundancy' as const, chapter: 'ch-one', scene: 'scene-one', target: 'walked slowly', replacement: 'walked', before: 'He ', after: ' home.' };

test('identity is stable outside target text and replacement affects evidence only', () => {
  const first = makeProposal(base); const differentSceneContext = makeProposal({ ...base, before: 'Then he ' }); const otherEdit = makeProposal({ ...base, replacement: 'moved' });
  assert.equal(first.id, differentSceneContext.id);
  assert.equal(first.id, otherEdit.id);
  assert.notEqual(first.fingerprint.evidence, otherEdit.fingerprint.evidence);
});

test('locator handles unique and normalized whitespace matches', () => {
  assert.deepEqual(locate('He walked slowly home.', { text: 'walked slowly' }), { ok: true, start: 3, end: 16, moved: false });
  assert.deepEqual(locate('He walked   slowly home.', { text: 'walked slowly' }), { ok: true, start: 3, end: 18, moved: false });
  const text = '😀 foo bar';
  const hit = locate(text, { text: 'foo' });
  assert.deepEqual(hit, { ok: true, start: text.indexOf('foo'), end: text.indexOf('foo') + 3, moved: false });
});

test('locator uses context and then a valid occurrence to resolve duplicates', () => {
  const text = 'She said go. He said go.';
  assert.deepEqual(locate(text, { text: 'said go', before: 'He ', after: '.' }), { ok: true, start: 16, end: 23, moved: false });
  assert.deepEqual(locate('one go, two go', { text: 'go', occurrence: 1 }), { ok: true, start: 12, end: 14, moved: false });
  assert.deepEqual(locate('one go, two go', { text: 'go', occurrence: 4 }), { ambiguous: true });
});

test('missing targets are stale and multi-paragraph replacements are refused', () => {
  assert.deepEqual(locate('nothing here', { text: 'missing' }), { stale: true });
  assert.throws(() => locate('one', { text: 'one', replacement: 'first\n\nsecond' }), /replacement-spans-paragraphs/);
});
