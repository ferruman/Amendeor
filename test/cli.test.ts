import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/cli.ts');

test('no-key mechanical edit is deterministic and the second run is fully cached', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'amendeor-cli-'));
  await mkdir(path.join(root, 'manuscript/chapters'), { recursive: true });
  await writeFile(path.join(root, 'codicora.yaml'), 'spec: codicora/v1\ntype: project\nmanuscript: { path: manuscript }\n');
  await writeFile(path.join(root, 'manuscript/manuscript.yaml'), 'schema_version: 1\nlanguage: en\nchapters: [{ slug: one, title: One }]\n');
  await writeFile(path.join(root, 'manuscript/chapters/one.md'), '<!-- scene: one -->\nShe said said yes.\n');
  const env = { PATH: process.env.PATH, HOME: root, XDG_CONFIG_HOME: path.join(root, 'no-user-config') };
  const inspection = await execFileAsync(process.execPath, [cli, 'inspect', root, '--json'], { env });
  const inspectResult = JSON.parse(inspection.stdout) as { words: number; pack: { status: string } };
  assert.ok(inspectResult.words > 0); assert.equal(inspectResult.pack.status, 'loaded');
  await assert.rejects(stat(path.join(root, '.codicora/amendeor/runs')));
  const first = await execFileAsync(process.execPath, [cli, 'edit', root, '--mode', 'mechanical', '--json'], { env });
  const firstResult = JSON.parse(first.stdout) as { run_id: string; proposals: number; message: string };
  assert.equal(firstResult.message, 'rules only'); assert.ok(firstResult.proposals > 0);
  const firstLines = (await readFile(path.join(root, '.codicora/amendeor/runs', firstResult.run_id, 'proposals.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as { id: string; replacement: string });
  const second = await execFileAsync(process.execPath, [cli, 'edit', root, '--mode', 'mechanical', '--json'], { env });
  const secondResult = JSON.parse(second.stdout) as { run_id: string; proposals: number; stages: Array<{ units: { cached: number; computed: number } }> };
  const secondLines = (await readFile(path.join(root, '.codicora/amendeor/runs', secondResult.run_id, 'proposals.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as { id: string; replacement: string });
  assert.deepEqual(firstLines.map((item) => [item.id, item.replacement]), secondLines.map((item) => [item.id, item.replacement]));
  assert.equal(secondResult.stages[0]!.units.computed, 0);
  assert.ok(secondResult.stages[0]!.units.cached > 0);
  const report = await execFileAsync(process.execPath, [cli, 'report', root], { env });
  assert.match(report.stdout, /rules only/);
  const diff = await execFileAsync(process.execPath, [cli, 'diff', root, '--json'], { env });
  const changes = JSON.parse(diff.stdout) as { changes: Array<{ state: string }> };
  assert.ok(changes.changes.every((item) => item.state === 'unchanged'));
});

test('Russian title grammar proposal can be accepted into the edited manifest', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'amendeor-title-'));
  await mkdir(path.join(root, 'manuscript/chapters'), { recursive: true });
  await writeFile(path.join(root, 'codicora.yaml'), 'spec: codicora/v1\ntype: project\nmanuscript: { path: manuscript }\n');
  const manifest = 'schema_version: 1\nlanguage: ru\nchapters:\n  - slug: one\n    title: Три утраченных суток\n';
  await writeFile(path.join(root, 'manuscript/manuscript.yaml'), manifest);
  await writeFile(path.join(root, 'manuscript/chapters/one.md'), '<!-- scene: one -->\nПрошло трое суток.\n');
  const env = { PATH: process.env.PATH, HOME: root, XDG_CONFIG_HOME: path.join(root, 'no-user-config') };
  const edit = await execFileAsync(process.execPath, [cli, 'edit', root, '--mode', 'mechanical', '--json'], { env });
  const runId = (JSON.parse(edit.stdout) as { run_id: string }).run_id;
  const proposals = (await readFile(path.join(root, '.codicora/amendeor/runs', runId, 'proposals.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as { id: string; location: { scene: string }; target: { text: string }; replacement: string });
  const titleProposal = proposals.find((item) => item.location.scene === '@title');
  assert.ok(titleProposal);
  assert.equal(titleProposal.target.text, 'Три утраченных суток');
  assert.equal(titleProposal.replacement, 'Трое утраченных суток');
  const acceptance = await execFileAsync(process.execPath, [cli, 'accept', root, titleProposal.id, '--json'], { env });
  assert.ok((JSON.parse(acceptance.stdout) as { results: Array<{ scene: string; status: string }> }).results.some((item) => item.scene === '@title' && item.status === 'applied'));
  assert.equal(await readFile(path.join(root, 'manuscript/manuscript.yaml'), 'utf8'), manifest);
  assert.match(await readFile(path.join(root, 'edited/manuscript.yaml'), 'utf8'), /title: Трое утраченных суток/);
  const report = await execFileAsync(process.execPath, [cli, 'report', root, '--json'], { env });
  assert.deepEqual((JSON.parse(report.stdout) as { run: { decisions: { accepted: number; stale: number } } }).run.decisions, { accepted: 1, stale: 0 });
  const diff = await execFileAsync(process.execPath, [cli, 'diff', root, '--json'], { env });
  assert.ok(!(JSON.parse(diff.stdout) as { changes: Array<{ id: string; state: string }> }).changes.some((item) => item.id === titleProposal.id && item.state === 'stale'));
  await writeFile(path.join(root, 'manuscript/manuscript.yaml'), manifest.replace('Три утраченных суток', 'Три долгих суток'));
  await assert.rejects(execFileAsync(process.execPath, [cli, 'edit', root, '--mode', 'mechanical', '--resume', runId, '--json'], { env }), /resume input differs/);
});

test('missing pack warning appears in console, run manifest, and report', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'amendeor-pack-'));
  const file = path.join(root, 'one.md'); await writeFile(file, 'Small small words.\n');
  const out = path.join(root, 'output');
  const env = { PATH: process.env.PATH, HOME: root, XDG_CONFIG_HOME: path.join(root, 'no-user-config') };
  const inspection = await execFileAsync(process.execPath, [cli, 'inspect', file, '--lang', 'zz', '--out', out, '--json'], { env });
  assert.match(inspection.stderr, /pack missing/);
  const edit = await execFileAsync(process.execPath, [cli, 'edit', file, '--lang', 'zz', '--out', out, '--json'], { env });
  assert.match(edit.stderr, /pack missing/);
  const run = JSON.parse(edit.stdout) as { run_id: string };
  const manifest = JSON.parse(await readFile(path.join(out, '.codicora/amendeor/runs', run.run_id, 'run.json'), 'utf8')) as { warnings: string[] };
  assert.ok(manifest.warnings.some((warning) => warning.includes('pack missing')));
  const report = await execFileAsync(process.execPath, [cli, 'report', file, '--lang', 'zz', '--out', out], { env });
  assert.match(report.stdout, /pack missing/);
});

test('auto acceptance uses edited copy and diff reports a stale accepted target', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'amendeor-auto-'));
  await mkdir(path.join(root, 'manuscript/chapters'), { recursive: true });
  await writeFile(path.join(root, 'codicora.yaml'), 'spec: codicora/v1\ntype: project\nmanuscript: { path: manuscript }\n');
  await writeFile(path.join(root, 'amendeor.yaml'), 'auto_accept: [mechanical]\n');
  await writeFile(path.join(root, 'manuscript/manuscript.yaml'), 'schema_version: 1\nlanguage: en\nchapters: [{ slug: one, title: One }]\n');
  const sourceFile = path.join(root, 'manuscript/chapters/one.md');
  await writeFile(sourceFile, '<!-- scene: one -->\nShe said said yes.\n');
  const env = { PATH: process.env.PATH, HOME: root, XDG_CONFIG_HOME: path.join(root, 'no-user-config') };
  await execFileAsync(process.execPath, [cli, 'edit', root, '--json'], { env });
  assert.equal(await readFile(sourceFile, 'utf8'), '<!-- scene: one -->\nShe said said yes.\n');
  assert.equal(await readFile(path.join(root, 'edited/chapters/one.md'), 'utf8'), '<!-- scene: one -->\nShe said yes.\n');
  await writeFile(sourceFile, '<!-- scene: one -->\nShe agreed.\n');
  await execFileAsync(process.execPath, [cli, 'edit', root, '--json'], { env });
  const diff = await execFileAsync(process.execPath, [cli, 'diff', root, '--json'], { env });
  assert.ok((JSON.parse(diff.stdout) as { changes: Array<{ state: string }> }).changes.some((item) => item.state === 'stale'));
});

test('author-rejected proposal is omitted while its target hash stays the same', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'amendeor-reject-'));
  await mkdir(path.join(root, 'manuscript/chapters'), { recursive: true });
  await writeFile(path.join(root, 'codicora.yaml'), 'spec: codicora/v1\ntype: project\nmanuscript: { path: manuscript }\n');
  await writeFile(path.join(root, 'manuscript/manuscript.yaml'), 'schema_version: 1\nlanguage: en\nchapters: [{ slug: one, title: One }]\n');
  await writeFile(path.join(root, 'manuscript/chapters/one.md'), '<!-- scene: one -->\nShe said said yes.\n');
  const env = { PATH: process.env.PATH, HOME: root, XDG_CONFIG_HOME: path.join(root, 'no-user-config') };
  const first = await execFileAsync(process.execPath, [cli, 'edit', root, '--json'], { env });
  const runId = (JSON.parse(first.stdout) as { run_id: string }).run_id;
  const line = (await readFile(path.join(root, '.codicora/amendeor/runs', runId, 'proposals.jsonl'), 'utf8')).trim();
  const id = (JSON.parse(line) as { id: string }).id;
  await execFileAsync(process.execPath, [cli, 'reject', root, id, '--json'], { env });
  const second = await execFileAsync(process.execPath, [cli, 'edit', root, '--json'], { env });
  assert.equal((JSON.parse(second.stdout) as { proposals: number }).proposals, 0);
});

test('inspect reports formulaic evidence without changing the input', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'amendeor-inspect-'));
  const file = path.join(root, 'one.md');
  const original = "Here's the thing: the gate was open.\n";
  await writeFile(file, original);
  const env = { PATH: process.env.PATH, HOME: root, XDG_CONFIG_HOME: path.join(root, 'no-user-config') };
  const result = await execFileAsync(process.execPath, [cli, 'inspect', file, '--lang', 'en', '--json'], { env });
  const summary = JSON.parse(result.stdout) as { formulaic: Array<{ id: string; quote: string }> };
  assert.deepEqual(summary.formulaic.map((hit) => [hit.id, hit.quote]), [['formulaic.throat-clearing', "Here's the thing"]]);
  assert.equal(await readFile(file, 'utf8'), original);
});
