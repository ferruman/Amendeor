import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { openSource } from '../src/source/index.ts';
import { loadConfig } from '../src/config.ts';
import { loadPack } from '../src/lang/pack.ts';
import { editMechanical } from '../src/edit/mechanical.ts';
import { parseEdits } from '../src/edit/parse.ts';

test('parser discards missing targets and paragraph rewrites', () => {
  const output = JSON.stringify({ edits: [
    { target: 'missing', replacement: 'other', category: 'grammar', reason: 'x' },
    { target: 'The door', replacement: 'A door\n\nAnother door', category: 'clarity', reason: 'x' }
  ] });
  const parsed = parseEdits(output, 'The door was open.');
  assert.equal(parsed.edits.length, 0);
  assert.deepEqual(parsed.discarded.map((item) => item.reason), ['target-not-verbatim-in-window', 'multi-paragraph-replacement']);
});

test('local copy pass counts NO_CHANGE and caches successful windows', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'amendeor-model-'));
  try {
    const manuscript = path.join(dir, 'book.md');
    await writeFile(manuscript, 'The door was open. The room was quiet.\n');
    const loaded = await loadConfig({ env: { HOME: dir }, cli: { providers: { local: { transport: 'local' } }, profiles: { edit: { provider: 'local', model: 'fixture', context_budget: 500 } } } });
    const source = await openSource(manuscript, { lang: 'en', out: path.join(dir, 'out') });
    const pack = await loadPack('en');
    const first = await editMechanical(source, loaded, pack, { mode: 'copy' });
    const firstStage = first.run.stages as Array<{ name: string; no_change?: number; sent?: number; cached?: number }>;
    assert.equal(first.proposals.length, 0);
    assert.equal(firstStage.find((item) => item.name === 'model')?.no_change, 1);
    assert.equal(firstStage.find((item) => item.name === 'model')?.sent, 1);
    const second = await editMechanical(source, loaded, pack, { mode: 'copy' });
    const secondStage = second.run.stages as Array<{ name: string; no_change?: number; sent?: number; cached?: number }>;
    assert.equal(secondStage.find((item) => item.name === 'model')?.sent, 0);
    assert.equal(secondStage.find((item) => item.name === 'model')?.cached, 1);
    const resumed = await editMechanical(source, loaded, pack, { mode: 'copy', runId: first.run_id });
    assert.equal(resumed.run_id, first.run_id);
    assert.equal((resumed.run.stages as Array<{ name: string; cached?: number }>).find((item) => item.name === 'model')?.cached, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('local copy proposals are withheld when verification is not configured', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'amendeor-proposal-'));
  try {
    const manuscript = path.join(dir, 'book.md');
    const script = path.join(dir, 'script.json');
    await writeFile(manuscript, 'The door was open.\n');
    await writeFile(script, JSON.stringify({ default: JSON.stringify({ edits: [{ target: 'was open', replacement: 'stood open', category: 'word-choice', reason: 'clearer' }] }) }));
    const loaded = await loadConfig({ env: { HOME: dir }, cli: { providers: { local: { transport: 'local', endpoint: script } }, profiles: { edit: { provider: 'local', model: 'fixture' } } } });
    const source = await openSource(manuscript, { lang: 'en', out: path.join(dir, 'out') });
    const result = await editMechanical(source, loaded, await loadPack('en'), { mode: 'copy' });
    assert.equal(result.proposals.length, 0);
    assert.equal((result.run.guard as { semantic_rejected: number }).semantic_rejected, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('three agreeing local verifier passes offer a guarded proposal', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'amendeor-verified-'));
  try {
    const manuscript = path.join(dir, 'book.md');
    const script = path.join(dir, 'script.json');
    await writeFile(manuscript, 'The door was open.\n');
    await writeFile(script, JSON.stringify({ responses: {
      editor: JSON.stringify({ edits: [{ target: 'was open', replacement: 'stood open', category: 'word-choice', reason: 'clearer' }] }),
      verifier: JSON.stringify({ preserved: true, reason: 'same meaning' })
    } }));
    const loaded = await loadConfig({ env: { HOME: dir }, cli: { providers: { local: { transport: 'local', endpoint: script } }, profiles: { edit: { provider: 'local', model: 'editor' }, verify: { provider: 'local', model: 'verifier', passes: 3 } } } });
    const source = await openSource(manuscript, { lang: 'en', out: path.join(dir, 'out') });
    const result = await editMechanical(source, loaded, await loadPack('en'), { mode: 'copy' });
    assert.equal(result.proposals.length, 1);
    assert.equal(result.proposals[0]!.unverified, undefined);
    assert.deepEqual(result.proposals[0]!.verification, { passes: 3, agreed: 3, semantic_risk: 'none', voice: 'ok' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('mechanical mode calls a configured local profile only on candidate windows', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'amendeor-mechanical-model-'));
  try {
    const manuscript = path.join(dir, 'book.md');
    await writeFile(manuscript, 'The door door was open.\n');
    const source = await openSource(manuscript, { lang: 'en', out: path.join(dir, 'out') });
    const noProfile = await loadConfig({ env: { HOME: dir } });
    const plain = await editMechanical(source, noProfile, await loadPack('en'), { mode: 'mechanical' });
    assert.equal((plain.run.stages as Array<{ name: string; status: string }>).find((item) => item.name === 'model')?.status, 'skipped');
    const configured = await loadConfig({ env: { HOME: dir }, cli: { providers: { local: { transport: 'local' } }, profiles: { edit: { provider: 'local', model: 'fixture' } } } });
    const model = await editMechanical(source, configured, await loadPack('en'), { mode: 'mechanical' });
    assert.equal((model.run.stages as Array<{ name: string; windows?: number }>).find((item) => item.name === 'model')?.windows, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
