import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { openSource } from '../src/source/index.ts';
import { loadConfig } from '../src/config.ts';
import { loadPack } from '../src/lang/pack.ts';
import { editMechanical } from '../src/edit/mechanical.ts';

async function scenario(text: string, editAnswer: unknown, language = 'en') {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'amendeor-formulaic-'));
  const manuscript = path.join(dir, 'book.md'), script = path.join(dir, 'script.json');
  await writeFile(manuscript, text);
  await writeFile(script, JSON.stringify({ responses: { editor: JSON.stringify(editAnswer), verifier: JSON.stringify({ preserved: true, reason: 'same meaning' }) } }));
  const loaded = await loadConfig({ env: { HOME: dir }, cli: { providers: { local: { transport: 'local', endpoint: script } }, profiles: { edit: { provider: 'local', model: 'editor' }, verify: { provider: 'local', model: 'verifier' } } } });
  const source = await openSource(manuscript, { lang: language, out: path.join(dir, 'out') });
  try { return await editMechanical(source, loaded, await loadPack(language), { mode: 'copy' }); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

test('a formulaic hit can become a verified prose proposal with evidence', async () => {
  const result = await scenario('At the end of the day, the door remained shut.\n', { edits: [{ target: 'At the end of the day, the', replacement: 'The', category: 'prose-pattern', reason: 'Remove the stock frame.' }] });
  assert.equal(result.proposals.length, 1, JSON.stringify(result.run.stages));
  assert.equal(result.proposals[0]!.category, 'prose-pattern');
  assert.equal(result.proposals[0]!.impact, 'prose');
  assert.deepEqual(result.proposals[0]!.source_findings, ['formulaic.filler-frame']);
  assert.equal(result.proposals[0]!.verification.passes, 3);
});

test('a model-labelled clarity edit that removes a formulaic signal retains pattern evidence', async () => {
  const result = await scenario('At the end of the day, the door remained shut.\n', { edits: [{ target: 'At the end of the day, the door remained shut.', replacement: 'The door remained shut.', category: 'clarity', reason: 'Remove the stock frame.' }] });
  assert.equal(result.proposals.length, 1);
  assert.equal(result.proposals[0]!.category, 'prose-pattern');
  assert.equal(result.proposals[0]!.impact, 'prose');
  assert.deepEqual(result.proposals[0]!.source_findings, ['formulaic.filler-frame']);
});

test('NO_CHANGE on formulaic prose is counted', async () => {
  const result = await scenario('At the end of the day, the door remained shut.\n', { edits: [] });
  assert.equal(result.proposals.length, 0);
  const stage = (result.run.stages as Array<{ name: string; no_change?: number; no_change_by_chapter?: Record<string, number>; windows_by_chapter?: Record<string, number> }>).find((item) => item.name === 'model');
  assert.equal(stage?.no_change, 1);
  assert.equal(stage?.no_change_by_chapter?.book, 1);
  assert.equal(stage?.windows_by_chapter?.book, 1);
});

test('invented specificity and changed certainty do not reach the author', async () => {
  const specific = await scenario('At the end of the day, the door remained shut.\n', { edits: [{ target: 'At the end of the day', replacement: 'At 10:14 in London', category: 'prose-pattern', reason: 'vivid' }] });
  assert.equal(specific.proposals.length, 0);
  assert.equal((specific.run.guard as { semantic_rejected: number }).semantic_rejected, 1);
  const uncertain = await scenario('At the end of the day, perhaps the door was shut.\n', { edits: [{ target: 'At the end of the day, perhaps', replacement: 'Certainly', category: 'prose-pattern', reason: 'concise' }] });
  assert.equal(uncertain.proposals.length, 0);
  assert.equal((uncertain.run.guard as { semantic_rejected: number }).semantic_rejected, 1);
});

test('dialogue and intentional repetition are kept out of formulaic targeting', async () => {
  const dialogue = await scenario('“At the end of the day, I stay,” she said.\n', { edits: [{ target: 'At the end of the day', replacement: 'Finally', category: 'prose-pattern', reason: 'shorter' }] });
  assert.equal(dialogue.proposals.length, 0);
  const repeated = await scenario('Again and again, she waited. Again and again, she waited.\n', { edits: [] });
  assert.equal(repeated.proposals.filter((item) => item.category === 'prose-pattern').length, 0);
});
