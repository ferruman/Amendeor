import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Cache } from '../src/cache.ts';

test('concurrent writes to one cache key leave a complete answer and no temporary files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'amendeor-cache-'));
  try {
    const cache = new Cache(root);
    const answers = Array.from({ length: 32 }, (_, index) => ({ index, text: String(index).repeat(10000) }));
    await Promise.all(answers.map((answer) => cache.write('review', { text: 'same window' }, answer)));
    const stored = await cache.read<(typeof answers)[number]>('review', { text: 'same window' });
    assert.ok(stored);
    assert.deepEqual(stored, answers[stored.index]);
    const files = await readdir(path.join(root, 'cache/review'));
    assert.equal(files.length, 1);
    assert.ok(files[0]!.endsWith('.json'));
  } finally { await rm(root, { recursive: true, force: true }); }
});
