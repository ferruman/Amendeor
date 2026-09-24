import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256, canonicalJson, normalizeQuote, normalizeText } from '../src/hash.ts';

test('quote hashes match the Codicora findings contract', () => {
  assert.equal(sha256(normalizeQuote('counted the lanterns on the far bank, then counted them again')), 'sha256:28d5058ed87db54b27387681601f3676d2e2a053f53d9d6a567b8e93f98d1b38');
  assert.equal(sha256(normalizeQuote('Ilya, nineteen that spring')), 'sha256:cdaa5dde612b7ef6ec9802d9d3b87f3f7bd60179c9433500c847dfa5901f576a');
});

test('canonical JSON sorts nested object keys and omits undefined members', () => {
  assert.equal(canonicalJson({ z: 1, a: { y: 2, x: undefined, b: 3 } }), '{"a":{"b":3,"y":2},"z":1}');
});

test('normalizeText applies the findings text normalization', () => {
  assert.equal(normalizeText('\uFEFFcafe\u0301  \r\nline\t\r\n\r\n\r\nend  '), 'café\nline\n\nend\n');
  assert.equal(normalizeText('already normalized\n'), 'already normalized\n');
});
