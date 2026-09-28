import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { openSource } from '../src/source/index.ts';
import { loadConfig } from '../src/config.ts';
import { loadPack } from '../src/lang/pack.ts';
import { editMechanical } from '../src/edit/mechanical.ts';
import { parseEdits } from '../src/edit/parse.ts';
import { classifyEdit } from '../src/edit/classify.ts';
import { acceptProposals, rejectProposals } from '../src/edited/decisions.ts';
import { buildEdited } from '../src/edited/build.ts';

test('parser discards missing targets and paragraph rewrites', () => {
  const output = JSON.stringify({ edits: [
    { target: 'missing', replacement: 'other', category: 'grammar', reason: 'x' },
    { target: 'The door', replacement: 'A door\n\nAnother door', category: 'clarity', reason: 'x' }
  ] });
  const parsed = parseEdits(output, 'The door was open.');
  assert.equal(parsed.edits.length, 0);
  assert.deepEqual(parsed.discarded.map((item) => item.reason), ['target-not-verbatim-in-window', 'multi-paragraph-replacement']);
});

test('model case and punctuation edits are prose; whitespace and pack variants stay mechanical', async () => {
  const pack = (await loadPack('en')).pack;
  assert.equal(classifyEdit('the  door', 'the door', pack), 'mechanical');
  assert.equal(classifyEdit('Bank', 'bank', pack), 'prose');
  assert.equal(classifyEdit('door, open', 'door open', pack), 'prose');
  const [a, b] = pack.spelling_variants[0]!;
  assert.equal(classifyEdit(a, b, pack), 'mechanical');
});

test('each repeat of the same error in a scene gets its own proposal and both apply', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'amendeor-repeat-'));
  try {
    const manuscript = path.join(dir, 'book.md');
    await writeFile(manuscript, 'He saw the the dog.\n\nLater she saw the the cat.\n');
    const source = await openSource(manuscript, { lang: 'en', out: path.join(dir, 'out') });
    const loaded = await loadConfig({ env: { HOME: dir } });
    const result = await editMechanical(source, loaded, await loadPack('en'), { mode: 'mechanical' });
    const doubled = result.proposals.filter((item) => item.source === 'rule:repetition.doubled-word');
    assert.equal(doubled.length, 2);
    const accepted = await acceptProposals(source.editedDir, doubled);
    const built = await buildEdited({ book: source.book, editedDir: source.editedDir, accepted });
    assert.ok(built.every((item) => item.status === 'applied'), JSON.stringify(built));
    assert.equal(await readFile(path.join(source.editedDir, 'chapters/book.md'), 'utf8'), 'He saw the dog.\n\nLater she saw the cat.\n');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('auto-accept skips a mechanical proposal that conflicts with the acceptance history', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'amendeor-conflict-'));
  try {
    const manuscript = path.join(dir, 'book.md');
    await writeFile(manuscript, 'He saw the the dog.\n');
    const source = await openSource(manuscript, { lang: 'en', out: path.join(dir, 'out') });
    const loaded = await loadConfig({ env: { HOME: dir }, cli: { auto_accept: ['mechanical'] } });
    const first = await editMechanical(source, await loadConfig({ env: { HOME: dir } }), await loadPack('en'), { mode: 'mechanical' });
    const proposal = first.proposals.find((item) => item.source === 'rule:repetition.doubled-word')!;
    await acceptProposals(source.editedDir, [{ ...proposal, replacement: 'the', fingerprint: { ...proposal.fingerprint, evidence: `sha256:${'0'.repeat(64)}` } }]);
    const second = await editMechanical(source, loaded, await loadPack('en'), { mode: 'mechanical' });
    assert.ok((second.run.warnings as string[]).includes(`conflicting-acceptance skipped: ${proposal.id}`));
  } finally { await rm(dir, { recursive: true, force: true }); }
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
    const resumedLatest = await editMechanical(source, loaded, pack, { mode: 'copy', runId: second.run_id });
    assert.equal((resumedLatest.run.baseline as { previous_run_id: string }).previous_run_id, first.run_id);
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
    await rejectProposals(source.stateDir, result.proposals);
    const again = await editMechanical(source, loaded, await loadPack('en'), { mode: 'copy' });
    assert.equal(again.proposals.length, 0);
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

test('proofread scans a clean Russian title and scene even without rule hits', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'amendeor-proofread-'));
  try {
    const manuscript = path.join(dir, 'book.md');
    await writeFile(manuscript, 'Она спокойно закрыла дверь.\n');
    const source = await openSource(manuscript, { lang: 'ru', out: path.join(dir, 'out') });
    const loaded = await loadConfig({ env: { HOME: dir }, cli: { providers: { local: { transport: 'local' } }, profiles: { edit: { provider: 'local', model: 'fixture' } } } });
    const result = await editMechanical(source, loaded, await loadPack('ru'), { mode: 'proofread' });
    const stage = (result.run.stages as Array<{ name: string; windows?: number; no_change?: number }>).find((item) => item.name === 'model');
    assert.equal(stage?.windows, 2);
    assert.equal(stage?.no_change, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('proofread offers a title correction and a comma correction only after independent verification', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'amendeor-proofread-verified-'));
  try {
    const manuscript = path.join(dir, 'Потерянный письмо.md');
    const script = path.join(dir, 'script.json');
    await writeFile(manuscript, 'Она знала что поезд ушёл.\n');
    await writeFile(script, JSON.stringify({ responses: {
      editor: JSON.stringify({ edits: [
        { target: 'Потерянный письмо', replacement: 'Потерянное письмо', category: 'grammar', reason: 'Adjective agrees with the neuter noun.' },
        { target: 'знала что', replacement: 'знала, что', category: 'punctuation', reason: 'Comma before subordinate clause.' }
      ] }),
      verifier: JSON.stringify({ necessary: true, preserved: true, reason: 'Comma separates a subordinate clause.' })
    } }));
    const source = await openSource(manuscript, { lang: 'ru', out: path.join(dir, 'out') });
    const loaded = await loadConfig({ env: { HOME: dir }, cli: { providers: { local: { transport: 'local', endpoint: script } }, profiles: { edit: { provider: 'local', model: 'editor' }, verify: { provider: 'local', model: 'verifier', passes: 1 } } } });
    const result = await editMechanical(source, loaded, await loadPack('ru'), { mode: 'proofread' });
    const title = result.proposals.find((item) => item.location.scene === '@title');
    assert.ok(title);
    const comma = result.proposals.find((item) => item.category === 'punctuation');
    assert.ok(comma, JSON.stringify(result.run.guard));
    assert.equal(comma.impact, 'prose');
    assert.equal(comma.replacement, 'знала, что');
    const accepted = await acceptProposals(source.editedDir, [title]);
    const built = await buildEdited({ book: source.book, editedDir: source.editedDir, accepted });
    assert.ok(built.some((item) => item.id === title.id && item.status === 'applied'));
    assert.match(await readFile(path.join(source.editedDir, 'manuscript.yaml'), 'utf8'), /title: "?Потерянное письмо"?/);
    assert.equal(await readFile(manuscript, 'utf8'), 'Она знала что поезд ушёл.\n');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('proofread withholds an optional comma when the verifier cannot justify it', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'amendeor-proofread-comma-'));
  try {
    const manuscript = path.join(dir, 'book.md');
    const script = path.join(dir, 'script.json');
    await writeFile(manuscript, 'Она знала что поезд ушёл.\n');
    await writeFile(script, JSON.stringify({ responses: {
      editor: JSON.stringify({ edits: [{ target: 'знала что', replacement: 'знала, что', category: 'punctuation', reason: 'Possible comma.' }] }),
      verifier: JSON.stringify({ necessary: false, preserved: true, reason: 'Uncertain.' })
    } }));
    const source = await openSource(manuscript, { lang: 'ru', out: path.join(dir, 'out') });
    const loaded = await loadConfig({ env: { HOME: dir }, cli: { providers: { local: { transport: 'local', endpoint: script } }, profiles: { edit: { provider: 'local', model: 'editor' }, verify: { provider: 'local', model: 'verifier', passes: 1 } } } });
    const result = await editMechanical(source, loaded, await loadPack('ru'), { mode: 'proofread' });
    assert.ok(!result.proposals.some((item) => item.category === 'punctuation'));
    assert.ok((result.run.guard as { rejections: Array<{ guard: string }> }).rejections.some((item) => item.guard === 'punctuation-verifier'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('proofread withholds modernization of a valid historical spelling', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'amendeor-proofread-voice-'));
  try {
    const manuscript = path.join(dir, 'book.md');
    const script = path.join(dir, 'script.json');
    await writeFile(manuscript, 'Она посмотрела за шкап.\n');
    await writeFile(script, JSON.stringify({ responses: {
      editor: JSON.stringify({ edits: [{ target: 'шкап', replacement: 'шкаф', category: 'spelling', reason: 'Modern spelling.' }] }),
      verifier: JSON.stringify({ necessary: false, preserved: true, reason: 'Historical spelling is valid in this prose.' })
    } }));
    const source = await openSource(manuscript, { lang: 'ru', out: path.join(dir, 'out') });
    const loaded = await loadConfig({ env: { HOME: dir }, cli: { providers: { local: { transport: 'local', endpoint: script } }, profiles: { edit: { provider: 'local', model: 'editor' }, verify: { provider: 'local', model: 'verifier', passes: 1 } } } });
    const result = await editMechanical(source, loaded, await loadPack('ru'), { mode: 'proofread' });
    assert.ok(!result.proposals.some((item) => item.target.text === 'шкап'));
    assert.ok((result.run.guard as { rejections: Array<{ guard: string }> }).rejections.some((item) => item.guard === 'objective-verifier'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
