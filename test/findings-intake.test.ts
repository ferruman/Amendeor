import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openSource } from '../src/source/index.ts';
import { loadConfig } from '../src/config.ts';
import { loadPack } from '../src/lang/pack.ts';
import { renderReport } from '../src/report.ts';
import { readFindings, validateFinding, routeFinding } from '../src/findings/intake.ts';
import { canonicalJson, normalizeQuote, sha256 } from '../src/hash.ts';
import { editWindows } from '../src/edit/windows.ts';
import { editMechanical } from '../src/edit/mechanical.ts';
import { guardProposals } from '../src/guard/index.ts';
import { makeProposal } from '../src/proposal/identity.ts';
import { acceptProposals } from '../src/edited/decisions.ts';
import { acceptAuthorized } from '../src/edited/authority.ts';
const run = '2026-10-11T00-00-00Z-abcd';
async function fixture(fn: (ctx: Awaited<ReturnType<typeof setup>>) => Promise<void>) { const ctx = await setup(); try { await fn(ctx); } finally { await rm(ctx.dir, { recursive: true, force: true }); } }
async function setup() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'amendeor-intake-'));
  const file = path.join(dir, 'book.md'); await writeFile(file, 'Silver lantern under glass.\n\nSilver lantern under glass.\n');
  const source = await openSource(file, { lang: 'en', out: path.join(dir, 'out') }); source.findingsDir = path.join(dir, 'findings');
  const scene = source.book.chapters[0]!.scenes[0]!;
  const primary = { category: 'repetition.ngram', chapter: null, scene: null, key: 'silver lantern under glass' };
  const quote = { type: 'quote' as const, scene: scene.id, text: 'Silver lantern under glass', hash: sha256(normalizeQuote('Silver lantern under glass')) };
  const evidence = [quote, { ...quote }];
  const finding = { schema: 'codicora.finding/0.1', id: 'esgardeor:' + sha256(canonicalJson(primary)).slice(7, 23), fingerprint: { primary, evidence: sha256(evidence.map((e) => `quote:${e.scene}:${e.hash}`).sort().join('\n')) }, run_id: run, tool: { name: 'esgardeor', version: '0.1.0' }, category: 'repetition.ngram', kind: 'concern', severity: 'medium', confidence: 1, scope: 'book', location: { primary: { chapter: 'book', scene: scene.id, path: 'ch01/s01', file: 'book.md', lines: [1, 1], content_hash: scene.contentHash }, related: [] }, evidence, status: 'open', summary: 'Repeated phrase', explanation: '' };
  const folder = path.join(source.findingsDir, 'esgardeor'); await mkdir(path.join(folder, 'runs', run), { recursive: true });
  const save = async (value = finding) => { await writeFile(path.join(folder, 'latest.json'), JSON.stringify({ run_id: run })); await writeFile(path.join(folder, 'runs', run, 'findings.jsonl'), JSON.stringify(value) + '\n'); };
  await save(); return { dir, source, scene, finding, save };
}

test('book evidence maps every occurrence to the correct windows; scene scope routes too', async () => fixture(async ({ source, finding }) => {
  const intake = await readFindings(source); assert.equal(intake.applicable, 1); assert.equal(intake.signals.length, 2);
  assert.deepEqual(intake.signals.map((h) => h.start), [0, 29]);
  const windows = editWindows(source.book, 'copy', 128, [], [], intake.signals); assert.equal(windows.flatMap((w) => w.signals).length, 2);
  const local = validateFinding(finding, 'esgardeor', run); local.scope = 'scene';
  assert.equal(routeFinding(source, local).signals.length, 2);
}));

test('latest status wins; motifs can be protected, reopened and evidence-bound', async () => fixture(async ({ source, finding }) => {
  const overlay = path.join(source.findingsDir!, '_status.jsonl');
  const status = (value: string, evidence?: string) => JSON.stringify({ schema: 'codicora.status/0.1', finding_id: finding.id, status: value, by: 'author', at: '2026-10-11T00:00:00Z', ...(evidence ? { evidence } : {}) });
  for (const value of ['wontfix', 'false-positive', 'fixed']) { await writeFile(overlay, status(value)); const intake = await readFindings(source); assert.equal(intake.signals.length, 0); assert.equal(intake.protected.length, 2); }
  await writeFile(overlay, status('wontfix') + '\n' + status('open')); assert.equal((await readFindings(source)).signals.length, 2);
  await writeFile(overlay, status('wontfix', sha256('other'))); assert.equal((await readFindings(source)).signals.length, 2);
}));

test('partially stale evidence remains visible as already-resolved, with live occurrences intact', async () => fixture(async ({ source, scene }) => {
  scene.text = 'Silver lantern under glass.';
  const intake = await readFindings(source); assert.equal(intake.signals.length, 1);
  assert.equal(intake.items.filter((i) => i.classification === 'already-resolved').length, 1);
  assert.match(renderReport({ findings: { items: intake.items } }), /already-resolved/);
  scene.text = 'The lamp is gone.'; const stale = await readFindings(source); assert.equal(stale.signals.length, 0); assert.equal(stale.items.filter((i) => i.classification === 'already-resolved').length, 2);
}));

test('corrupt hashes, duplicate ids, unsafe run paths and unreadable overlays never create targets', async () => fixture(async ({ source, finding, save }) => {
  await save({ ...finding, evidence: finding.evidence.map((q) => ({ ...q, hash: sha256('wrong') })) }); assert.equal((await readFindings(source)).signals.length, 0);
  await save(); const folder = path.join(source.findingsDir!, 'esgardeor');
  await writeFile(path.join(folder, 'runs', run, 'findings.jsonl'), [finding, finding].map((f) => JSON.stringify(f)).join('\n')); assert.match((await readFindings(source)).warnings.join(''), /duplicate/);
  await save(); await writeFile(path.join(folder, 'latest.json'), JSON.stringify({ run_id: '../../outside' })); assert.equal((await readFindings(source)).signals.length, 0);
  await save(); await writeFile(path.join(source.findingsDir!, '_status.jsonl'), '{'); assert.equal((await readFindings(source)).signals.length, 0);
}));

test('findings prose uses three meaning passes even when necessity and one pass are configured; author consent remains mandatory', async () => fixture(async ({ dir, source, scene, finding }) => {
  const script = path.join(dir, 'script.json'); await writeFile(script, JSON.stringify({ responses: { verifier: JSON.stringify({ preserved: true, reason: 'same meaning' }) } }));
  const loaded = await loadConfig({ env: { HOME: dir }, cli: { providers: { local: { transport: 'local', endpoint: script } }, profiles: { verify: { provider: 'local', model: 'verifier', passes: 1, check: 'necessity' } } } });
  const proposal = makeProposal({ chapter: 'book', scene: scene.id, category: 'prose-pattern', target: 'Silver lantern under glass', replacement: 'Silver lamp under glass', before: '', after: '.', occurrence: 0, run_id: run, source: 'model', reason: 'vary the phrase', impact: 'prose', content_hash: scene.contentHash, unverified: true, source_findings: [finding.id] });
  const guarded = await guardProposals(source, loaded, await loadPack('en'), [proposal]);
  assert.equal(guarded.proposals.length, 1, JSON.stringify(guarded.stage)); const offered = guarded.proposals[0]!;
  assert.equal(offered.verification.passes, 3); assert.equal(offered.unverified, true); assert.equal(offered.impact, 'prose');
  await assert.rejects(acceptProposals(source.editedDir, [offered], { acceptedBy: 'human:cli' }), /unverified-proposal/);
  await assert.rejects(acceptAuthorized(source.editedDir, [offered], { acceptedBy: 'cli:agent' }), /unverified-proposal/);
  const accepted = await acceptProposals(source.editedDir, [offered], { acceptedBy: 'human:ui', allowUnverified: true }); assert.equal(accepted.length, 1);
}));

test('wontfix blocks an overlapping model edit and source text stays unchanged', async () => fixture(async ({ dir, source, finding, scene }) => {
  await writeFile(path.join(source.findingsDir!, '_status.jsonl'), JSON.stringify({ schema: 'codicora.status/0.1', finding_id: finding.id, status: 'wontfix', by: 'author', at: '2026-10-11T00:00:00Z' }));
  const script = path.join(dir, 'script.json'); await writeFile(script, JSON.stringify({ responses: { editor: JSON.stringify({ edits: [{ target: 'Silver lantern under glass.', replacement: 'Lantern beneath glass.', category: 'clarity', reason: 'vary' }] }) } }));
  const loaded = await loadConfig({ env: { HOME: dir }, cli: { providers: { local: { transport: 'local', endpoint: script } }, profiles: { edit: { provider: 'local', model: 'editor' } } } });
  const before = scene.text; const result = await editMechanical(source, loaded, await loadPack('en'), { mode: 'copy' });
  assert.equal(result.proposals.length, 0); assert.equal(scene.text, before); assert.match(result.report, /skipped/);
}));

test('book-scope evidence reaches windows in distinct chapters, with no chapter inferred from the primary anchor', async () => fixture(async ({ source, finding, save }) => {
  const original = source.book.chapters[0]!;
  source.book.chapters.push({ ...original, slug: 'second', scenes: [{ ...original.scenes[0]!, id: 'other-scene', text: 'Silver lantern under glass.' }] });
  const changed = structuredClone(finding); changed.evidence[1]!.scene = 'other-scene';
  changed.fingerprint.evidence = sha256(changed.evidence.map((e) => `quote:${e.scene}:${e.hash}`).sort().join('\n'));
  await save(changed);
  const intake = await readFindings(source);
  assert.deepEqual(intake.signals.map((h) => [h.chapter, h.scene]), [['book', 's0'], ['second', 'other-scene']]);
  const windows = editWindows(source.book, 'copy', 2048, [], [], intake.signals);
  assert.deepEqual(windows.flatMap((w) => w.signals.map((h) => [w.chapter, h.chapter])), [['book', 'book'], ['second', 'second']]);
}));

test('findings do not create prose targets without overlap or across paragraph boundaries', async () => fixture(async ({ dir, source }) => {
  const script = path.join(dir, 'script.json');
  const loaded = await loadConfig({ env: { HOME: dir }, cli: { providers: { local: { transport: 'local', endpoint: script } }, profiles: { edit: { provider: 'local', model: 'editor' }, verify: { provider: 'local', model: 'verifier' } } } });
  await writeFile(script, JSON.stringify({ responses: { editor: JSON.stringify({ edits: [{ target: source.book.chapters[0]!.scenes[0]!.text.trim(), replacement: 'Silver lamp under glass.', category: 'clarity', reason: 'shorter' }] }), verifier: JSON.stringify({ preserved: true, reason: 'same' }) } }));
  const result = await editMechanical(source, loaded, await loadPack('en'), { mode: 'copy', noCache: true });
  assert.equal(result.proposals.length, 0); assert.match(JSON.stringify(result.run.stages), /multi-paragraph-replacement|prose-pattern-crosses-paragraph/);
  source.book.chapters[0]!.scenes[0]!.text += '\n\nShe waited.';
  await writeFile(script, JSON.stringify({ responses: { editor: JSON.stringify({ edits: [{ target: 'She waited.', replacement: 'She paused.', category: 'prose-pattern', reason: 'vary' }] }) } }));
  const unrelated = await editMechanical(source, loaded, await loadPack('en'), { mode: 'copy', noCache: true });
  assert.equal(unrelated.proposals.length, 0); assert.match(JSON.stringify(unrelated.run.stages), /prose-pattern-without-trigger-overlap/);
}));

test('the real editor pipeline preserves source_findings and never auto-accepts findings prose', async () => fixture(async ({ dir, source, finding }) => {
  const script = path.join(dir, 'script.json');
  const edit = { target: 'Silver lantern under glass', replacement: 'Silver lamp under glass', category: 'word-choice', reason: 'Local variation justified in this scene.' };
  await writeFile(script, JSON.stringify({ responses: { editor: JSON.stringify({ edits: [edit, edit] }), verifier: JSON.stringify({ preserved: true, reason: 'same meaning' }) } }));
  const loaded = await loadConfig({ env: { HOME: dir }, cli: { auto_accept: ['mechanical'], providers: { local: { transport: 'local', endpoint: script } }, profiles: { edit: { provider: 'local', model: 'editor' }, verify: { provider: 'local', model: 'verifier', check: 'necessity', passes: 1 } } } });
  const result = await editMechanical(source, loaded, await loadPack('en'), { mode: 'copy', acceptAs: async () => ({ acceptedBy: 'human:cli' }) });
  assert.equal(result.proposals.length, 2, JSON.stringify(result.run.stages));
  for (const proposal of result.proposals) {
    assert.deepEqual(proposal.source_findings, [finding.id]); assert.equal(proposal.category, 'prose-pattern');
    assert.equal(proposal.impact, 'prose'); assert.equal(proposal.unverified, true); assert.equal(proposal.verification.passes, 3);
  }
  const { readAccepted } = await import('../src/edited/decisions.ts');
  assert.equal((await readAccepted(source.editedDir)).length, 0);
}));
