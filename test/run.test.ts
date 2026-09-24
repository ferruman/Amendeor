import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { newRunId, writeRun, readRun } from '../src/run/store.ts';
import { acquireLock } from '../src/run/lock.ts';
import { makeProposal } from '../src/proposal/identity.ts';

test('run ids use the stable UTC name format', () => {
  assert.match(newRunId(new Date('2026-09-24T10:00:00.000Z')), /^2026-09-24T10-00-00Z-[0-9a-f]{4}$/);
});

test('a failed run write removes its temporary directory and leaves latest untouched', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'amendeor-run-'));
  await assert.rejects(writeRun(root, '2026-09-24T10-00-00Z-aaaa', { '../escape': 'bad' }));
  assert.deepEqual(await readdir(path.join(root, 'runs')), []);
  await assert.rejects(readFile(path.join(root, 'latest.json')));
});

test('a run lock refuses a second run and releases cleanly', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'amendeor-lock-'));
  const release = await acquireLock(root);
  await assert.rejects(acquireLock(root), /run refused.*lock/);
  await release();
  const releaseAgain = await acquireLock(root);
  await releaseAgain();
});

test('readRun validates JSONL proposals and rejects duplicate ids', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'amendeor-readrun-'));
  const id = '2026-09-24T10-00-00Z-abcd';
  await writeRun(root, id, { 'proposals.jsonl': '\n', 'run.json': '{}\n' });
  assert.deepEqual((await readRun(root, 'latest')).proposals, []);
  const proposal = makeProposal({ category: 'spelling', chapter: 'one', scene: 's0', target: 'teh', replacement: 'the' });
  const duplicateRoot = await mkdtemp(path.join(os.tmpdir(), 'amendeor-duplicate-run-'));
  await writeRun(duplicateRoot, id, { 'proposals.jsonl': `${JSON.stringify(proposal)}\n${JSON.stringify(proposal)}\n` });
  await assert.rejects(readRun(duplicateRoot, 'latest'), /duplicate-proposal-id/);
});
