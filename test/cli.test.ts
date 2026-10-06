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
  assert.match(report.stdout, new RegExp(`^# Amendeor report — ${secondResult.run_id}\n\n\\d+ chapters · \\d+ scenes · \\d+ words · `));
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

test('Nora Gal check is a separate read-only diagnostic command', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'amendeor-gal-'));
  const file = path.join(root, 'one.md');
  const original = 'Он осуществляет проверку.\n';
  await writeFile(file, original);
  const env = { PATH: process.env.PATH, HOME: root, XDG_CONFIG_HOME: path.join(root, 'no-user-config') };
  const output = await execFileAsync(process.execPath, [cli, 'check', file, '--lang', 'ru', '--guide', 'nora-gal', '--rules-only', '--json'], { env });
  const result = JSON.parse(output.stdout) as { command: string; guide: string; version: string; count: number; findings: Array<{ id: string; quote: string }> };
  assert.equal(result.command, 'check');
  assert.equal(result.guide, 'nora-gal');
  assert.ok(result.version);
  assert.deepEqual(result.findings.map((item) => [item.id, item.quote]), [['office.action-noun', 'осуществляет проверку']]);
  assert.equal(result.count, 1);
  assert.equal(await readFile(file, 'utf8'), original);
  await assert.rejects(stat(path.join(root, '.codicora/amendeor/runs')));
  await assert.rejects(execFileAsync(process.execPath, [cli, 'check', file, '--lang', 'ru', '--guide', 'unknown'], { env }), /check requires --guide nora-gal/);
});

test('Nora Gal CLI contextual check uses two local profiles and reports verified evidence', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'amendeor-gal-cli-context-'));
  const file = path.join(root, 'one.md');
  const script = path.join(root, 'script.json');
  const config = path.join(root, 'amendeor.yaml');
  const original = 'Она испытала чувство радости, когда увидела брата.\n';
  await writeFile(file, original);
  await writeFile(script, JSON.stringify({ responses: {
    editor: JSON.stringify({ findings: [{ principle: 'gal.feeling-noun', quote: 'испытала чувство радости', reason: 'Отвлечённая рамка ослабляет непосредственное чувство героини в этой сцене.' }] }),
    verifier: JSON.stringify({ accepted: [0] })
  } }));
  await writeFile(config, `providers:\n  local: { transport: local, endpoint: ${script} }\nprofiles:\n  edit: { provider: local, model: editor }\n  verify: { provider: local, model: verifier, passes: 1 }\n`);
  const env = { PATH: process.env.PATH, HOME: root, XDG_CONFIG_HOME: path.join(root, 'no-user-config'), AMENDEOR_CONFIG: config };
  const output = await execFileAsync(process.execPath, [cli, 'check', file, '--lang', 'ru', '--guide', 'nora-gal', '--json'], { env });
  const result = JSON.parse(output.stdout) as { count: number; findings: Array<{ kind: string; principle: string; quote: string }>; contextual: { status: string; checked: number; failures: unknown[] } };
  assert.equal(result.contextual.status, 'ok');
  assert.equal(result.contextual.checked, 1);
  assert.deepEqual(result.contextual.failures, []);
  assert.equal(result.count, 1);
  assert.deepEqual(result.findings.map((item) => [item.kind, item.principle, item.quote]), [['contextual', 'gal.feeling-noun', 'испытала чувство радости']]);
  assert.equal(await readFile(file, 'utf8'), original);
});

test('accept --delegation: covered → accepted as the agent with provenance and a journal line; uncovered, expired or another book → refused', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'amendeor-delegation-'));
  await mkdir(path.join(root, 'manuscript/chapters'), { recursive: true });
  await writeFile(path.join(root, 'codicora.yaml'), 'spec: codicora/v1\ntype: project\nproject: { id: book-a }\nmanuscript: { path: manuscript }\n');
  await writeFile(path.join(root, 'manuscript/manuscript.yaml'), 'schema_version: 1\nlanguage: en\nchapters: [{ slug: one, title: One }]\n');
  await writeFile(path.join(root, 'manuscript/chapters/one.md'), '<!-- scene: one -->\nShe said said yes.\n');
  const env = { PATH: process.env.PATH, HOME: root, XDG_CONFIG_HOME: path.join(root, 'no-user-config'), CODICORA_AGENT: 'codex' };
  const edit = await execFileAsync(process.execPath, [cli, 'edit', root, '--mode', 'mechanical', '--json'], { env });
  const runId = (JSON.parse(edit.stdout) as { run_id: string }).run_id;
  const [proposal] = (await readFile(path.join(root, '.codicora/amendeor/runs', runId, 'proposals.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as { id: string });
  const grant = async (over: Record<string, unknown>) => {
    await mkdir(path.join(root, 'authority'), { recursive: true });
    await writeFile(path.join(root, 'authority/delegations.json'), JSON.stringify({ schema: 'codicora.delegations/0.1', delegations: [{ id: 'run', workspace: 'book-a', granted_by: 'author', granted_at: new Date(Date.now() - 60_000).toISOString(), expires_at: new Date(Date.now() + 3_600_000).toISOString(), allow: ['amendeor.accept'], ...over }] }));
  };
  const accept = () => execFileAsync(process.execPath, [cli, 'accept', root, proposal!.id, '--delegation', 'run', '--json'], { env });

  await assert.rejects(accept(), /not-delegated: no readable authority\/delegations.json/);
  await grant({ allow: ['imprimeor.release'] });
  await assert.rejects(accept(), /does not allow amendeor.accept/);
  await grant({ expires_at: new Date(Date.now() - 1000).toISOString() });
  await assert.rejects(accept(), /expired/);
  await grant({ workspace: 'book-b' });
  await assert.rejects(accept(), /belongs to workspace "book-b", not "book-a"/);
  await assert.rejects(stat(path.join(root, 'edited/accepted.jsonl')), 'nothing accepted');

  await grant({});
  await accept();
  const record = JSON.parse((await readFile(path.join(root, 'edited/accepted.jsonl'), 'utf8')).trim()) as Record<string, unknown>;
  assert.deepEqual([record.accepted_by, record.authority, record.authorized_by, record.delegation_id], ['cli:codex', 'delegated', 'author', 'run']);
  const line = JSON.parse(await readFile(path.join(root, 'authority/amendeor.jsonl'), 'utf8')) as Record<string, unknown>;
  assert.deepEqual([line.capability, line.performed_by, line.delegation_id], ['amendeor.accept', 'cli:codex', 'run']);
});

test('check --findings writes findings/amendeor/ in Codicora Findings v0.1; without a workspace it refuses', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'amendeor-findings-'));
  await mkdir(path.join(root, 'manuscript', 'chapters'), { recursive: true });
  await writeFile(path.join(root, 'codicora.yaml'), 'spec: codicora/v1\nproject:\n  id: t\n  source_language: ru\n');
  await writeFile(path.join(root, 'manuscript', 'manuscript.yaml'), 'schema_version: 1\nlanguage: ru\nchapters:\n  - slug: ch-1\n    title: "Один"\n');
  const text = '<!-- scene: s1 -->\nОн осуществляет проверку.\n';
  await writeFile(path.join(root, 'manuscript', 'chapters', 'ch-1.md'), text);
  const env = { PATH: process.env.PATH, HOME: root, XDG_CONFIG_HOME: path.join(root, 'no-user-config') };
  await execFileAsync(process.execPath, [cli, 'check', root, '--guide', 'nora-gal', '--rules-only', '--findings', '--json'], { env });
  const { run_id: runId } = JSON.parse(await readFile(path.join(root, 'findings/amendeor/latest.json'), 'utf8')) as { run_id: string };
  assert.match(runId, /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-[0-9a-f]{4}$/);
  const [line] = (await readFile(path.join(root, 'findings/amendeor/runs', runId, 'findings.jsonl'), 'utf8')).trim().split('\n');
  const f = JSON.parse(line!) as Record<string, any>;
  const { canonicalJson, sha256, normalizeQuote, normalizeText } = await import('../src/hash.ts');
  assert.equal(f.schema, 'codicora.finding/0.1');
  assert.equal(f.category, 'style.gal.action-noun');
  assert.equal(f.id, `amendeor:${sha256(canonicalJson(f.fingerprint.primary)).slice(7, 23)}`, 'id recomputes per FINDINGS.md §3');
  assert.equal(f.evidence[0].hash, sha256(normalizeQuote('осуществляет проверку')));
  assert.deepEqual([f.kind, f.scope, f.status, f.location.primary.chapter, f.location.primary.scene], ['concern', 'scene', 'open', 'ch-1', 's1']);
  const run = JSON.parse(await readFile(path.join(root, 'findings/amendeor/runs', runId, 'run.json'), 'utf8')) as Record<string, any>;
  assert.deepEqual(run.inputs.files, [{ path: 'manuscript/chapters/ch-1.md', content_hash: sha256(normalizeText(text)) }]);
  assert.equal(run.baseline.states[f.id], 'new');
  assert.equal(await readFile(path.join(root, 'manuscript', 'chapters', 'ch-1.md'), 'utf8'), text, 'the manuscript is untouched');

  const file = path.join(root, 'loose.md');
  await writeFile(file, 'Он осуществляет проверку.\n');
  await assert.rejects(execFileAsync(process.execPath, [cli, 'check', file, '--lang', 'ru', '--guide', 'nora-gal', '--rules-only', '--findings'], { env }), /needs a Codicora workspace/);
});

test('edit --delegation: model calls metered against amendeor.edit and the shared budget; journal carries cost and the delegation hash; over budget → refused before spending', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'amendeor-edit-deleg-'));
  await mkdir(path.join(root, 'manuscript/chapters'), { recursive: true });
  await mkdir(path.join(root, 'authority'), { recursive: true });
  await writeFile(path.join(root, 'codicora.yaml'), 'spec: codicora/v1\ntype: project\nproject: { id: book-a }\n');
  await writeFile(path.join(root, 'manuscript/manuscript.yaml'), 'schema_version: 1\nlanguage: en\nchapters: [{ slug: one, title: One }]\n');
  await writeFile(path.join(root, 'manuscript/chapters/one.md'), '<!-- scene: one -->\nThe door was open.\n');
  const script = path.join(root, 'script.json');
  await writeFile(script, JSON.stringify({ default: '{"edits":[]}' }));
  await writeFile(path.join(root, 'amendeor.yaml'), `providers:\n  local:\n    transport: local\n    endpoint: ${JSON.stringify(script)}\n    price: { input_per_m: 1, output_per_m: 2, currency: USD }\nprofiles:\n  edit: { provider: local, model: fixture }\n`);
  const env = { PATH: process.env.PATH, HOME: root, XDG_CONFIG_HOME: path.join(root, 'no-user-config'), CODICORA_AGENT: 'codex' };
  const entry = (max: number, allow = ['amendeor.edit']) => ({ id: 'run', workspace: 'book-a', granted_by: 'author', granted_at: new Date(Date.now() - 60_000).toISOString(), expires_at: new Date(Date.now() + 3_600_000).toISOString(), allow, limits: { max_spend: max, currency: 'USD' } });
  const grant = (d: Record<string, unknown>) => writeFile(path.join(root, 'authority/delegations.json'), JSON.stringify({ schema: 'codicora.delegations/0.1', delegations: [d] }));
  const edit = () => execFileAsync(process.execPath, [cli, 'edit', root, '--mode', 'copy', '--no-cache', '--delegation', 'run', '--json'], { env });
  const lines = async () => (await readFile(path.join(root, 'authority/amendeor.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l) as Record<string, any>);
  const { canonicalJson, sha256 } = await import('../src/hash.ts');

  await grant(entry(10, ['amendeor.accept']));
  await assert.rejects(edit(), /does not allow amendeor.edit/);

  const ok = entry(10);
  await grant(ok);
  await edit();
  const [line] = await lines();
  assert.deepEqual([line!.capability, line!.performed_by, line!.delegation_id, line!.currency], ['amendeor.edit', 'cli:codex', 'run', 'USD']);
  assert.ok(line!.cost > 0 && line!.cost < 0.01, String(line!.cost));
  assert.equal(line!.delegation_hash, sha256(canonicalJson(ok)));

  await grant(entry(line!.cost + 1e-9));
  await assert.rejects(edit(), (e: { code?: number; stderr?: string }) => e.code === 2 && /not-delegated: over the delegated budget/.test(e.stderr ?? ''));
  const refused = (await lines()).at(-1)!;
  assert.equal(refused.outcome, 'refused');
  assert.equal(refused.cost, undefined, 'nothing spent');
});

test('agent at the CLI without --delegation: accept refused, model passes refused before spending, rules still run; a person is unchanged', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'amendeor-agent-'));
  await mkdir(path.join(root, 'manuscript/chapters'), { recursive: true });
  await writeFile(path.join(root, 'codicora.yaml'), 'spec: codicora/v1\ntype: project\nproject: { id: book-a }\n');
  await writeFile(path.join(root, 'manuscript/manuscript.yaml'), 'schema_version: 1\nlanguage: en\nchapters: [{ slug: one, title: One }]\n');
  await writeFile(path.join(root, 'manuscript/chapters/one.md'), '<!-- scene: one -->\nShe said said yes.\n');
  const script = path.join(root, 'script.json');
  await writeFile(script, JSON.stringify({ default: '{"edits":[]}' }));
  await writeFile(path.join(root, 'amendeor.yaml'), `providers:\n  local:\n    transport: local\n    endpoint: ${JSON.stringify(script)}\n    price: { input_per_m: 1, output_per_m: 2, currency: USD }\nprofiles:\n  edit: { provider: local, model: fixture }\n`);
  const person = { PATH: process.env.PATH, HOME: root, XDG_CONFIG_HOME: path.join(root, 'no-user-config') };
  const agent = { ...person, CLAUDECODE: '1' };

  await assert.rejects(execFileAsync(process.execPath, [cli, 'edit', root, '--mode', 'copy', '--no-cache', '--json'], { env: agent }),
    (e: { code?: number; stderr?: string }) => e.code === 2 && /not-delegated: cli:claude-code ran this without --delegation/.test(e.stderr ?? ''));
  const mechanical = await execFileAsync(process.execPath, [cli, 'edit', root, '--mode', 'mechanical', '--json'], { env: person });
  const runId = (JSON.parse(mechanical.stdout) as { run_id: string }).run_id;
  const [proposal] = (await readFile(path.join(root, '.codicora/amendeor/runs', runId, 'proposals.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as { id: string });
  await assert.rejects(execFileAsync(process.execPath, [cli, 'accept', root, proposal!.id, '--json'], { env: agent }), /this terminal is an agent's \(cli:claude-code\)/);
  await assert.rejects(stat(path.join(root, 'edited/accepted.jsonl')), 'nothing accepted');

  await execFileAsync(process.execPath, [cli, 'accept', root, proposal!.id, '--json'], { env: person });
  const record = JSON.parse((await readFile(path.join(root, 'edited/accepted.jsonl'), 'utf8')).trim()) as Record<string, unknown>;
  assert.equal(record.accepted_by, 'human:cli');
});
