// Adversarial cases from the 2026-10-06 Astra/Sol audit: legitimate but unusual configuration and authority combinations.
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

async function workspace(allow: string[], deny: string[] = []) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'amendeor-adv-'));
  await mkdir(path.join(root, 'manuscript/chapters'), { recursive: true });
  await mkdir(path.join(root, 'authority'), { recursive: true });
  await writeFile(path.join(root, 'codicora.yaml'), 'spec: codicora/v1\ntype: project\nproject: { id: book-a }\n');
  await writeFile(path.join(root, 'manuscript/manuscript.yaml'), 'schema_version: 1\nlanguage: en\nchapters: [{ slug: one, title: One }]\n');
  await writeFile(path.join(root, 'manuscript/chapters/one.md'), '<!-- scene: one -->\nShe said said yes.\n');
  const script = path.join(root, 'script.json');
  await writeFile(script, JSON.stringify({ default: '{"edits":[]}' }));
  await writeFile(path.join(root, 'amendeor.yaml'), `auto_accept: [mechanical]\nproviders:\n  local:\n    transport: local\n    endpoint: ${JSON.stringify(script)}\n    price: { input_per_m: 1, output_per_m: 2, currency: USD }\nprofiles:\n  edit: { provider: local, model: fixture }\n`);
  await writeFile(path.join(root, 'authority/delegations.json'), JSON.stringify({ schema: 'codicora.delegations/0.1', delegations: [{ id: 'run', workspace: 'book-a', granted_by: 'author', granted_at: new Date(Date.now() - 60_000).toISOString(), expires_at: new Date(Date.now() + 3_600_000).toISOString(), allow, deny, limits: { max_spend: 10, currency: 'USD' } }] }));
  const env = { PATH: process.env.PATH, HOME: root, XDG_CONFIG_HOME: path.join(root, 'no-user-config'), CODICORA_AGENT: 'codex' };
  return { root, env };
}

test('auto_accept: mechanical does not escalate amendeor.edit into amendeor.accept: proposals generated, left pending, nothing recorded as author', async () => {
  const { root, env } = await workspace(['amendeor.edit'], ['amendeor.accept']);
  const out = await execFileAsync(process.execPath, [cli, 'edit', root, '--mode', 'copy', '--no-cache', '--delegation', 'run', '--json'], { env });
  const result = JSON.parse(out.stdout) as { run_id: string; proposals: number };
  assert.ok(result.proposals > 0, 'the edit itself is delegated and ran');
  await assert.rejects(stat(path.join(root, 'edited/accepted.jsonl')), 'nothing accepted');
  await assert.rejects(stat(path.join(root, 'edited/chapters/one.md')), 'no edited output');
  const run = JSON.parse(await readFile(path.join(root, '.codicora/amendeor/runs', result.run_id, 'run.json'), 'utf8')) as { warnings: string[] };
  assert.ok(run.warnings.some((w) => /auto-accept not performed.*denies amendeor\.accept/.test(w)), run.warnings.join('\n'));
  const journal = await readFile(path.join(root, 'authority/amendeor.jsonl'), 'utf8');
  assert.doesNotMatch(journal, /amendeor\.accept/);
});

test('auto_accept: mechanical under a delegation that allows amendeor.accept accepts as the agent, with delegated provenance', async () => {
  const { root, env } = await workspace(['amendeor.edit', 'amendeor.accept']);
  await execFileAsync(process.execPath, [cli, 'edit', root, '--mode', 'copy', '--no-cache', '--delegation', 'run', '--json'], { env });
  const records = (await readFile(path.join(root, 'edited/accepted.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
  assert.ok(records.length > 0);
  for (const r of records) assert.deepEqual([r.accepted_by, r.authority, r.authorized_by, r.delegation_id], ['cli:codex', 'delegated', 'author', 'run']);
  assert.equal(await readFile(path.join(root, 'edited/chapters/one.md'), 'utf8'), '<!-- scene: one -->\nShe said yes.\n');
  assert.match(await readFile(path.join(root, 'authority/amendeor.jsonl'), 'utf8'), /"capability":"amendeor\.accept","performed_by":"cli:codex"/);
});

test('auto_accept: mechanical for an agent without --delegation (rules only) accepts nothing', async () => {
  const { root, env } = await workspace(['amendeor.accept']);
  await execFileAsync(process.execPath, [cli, 'edit', root, '--mode', 'mechanical', '--json'], { env }).catch((e: { code?: number }) => assert.equal(e.code, 2));
  await assert.rejects(stat(path.join(root, 'edited/accepted.jsonl')));
});

test('a contextual check refused its model calls → the portable run says partial, not ok', async () => {
  const { root, env } = await workspace(['amendeor.accept']);
  await writeFile(path.join(root, 'manuscript/manuscript.yaml'), 'schema_version: 1\nlanguage: ru\nchapters: [{ slug: one, title: Один }]\n');
  await writeFile(path.join(root, 'manuscript/chapters/one.md'), '<!-- scene: one -->\nОн осуществляет проверку.\n');
  await writeFile(path.join(root, 'amendeor.yaml'), (await readFile(path.join(root, 'amendeor.yaml'), 'utf8')).replace('  edit: {', '  verify: { provider: local, model: fixture-2 }\n  edit: {'));
  await execFileAsync(process.execPath, [cli, 'check', root, '--guide', 'nora-gal', '--findings', '--json'], { env }).catch((e: { code?: number; stderr?: string }) => assert.equal(e.code, 2, e.stderr));
  const { run_id } = JSON.parse(await readFile(path.join(root, 'findings/amendeor/latest.json'), 'utf8')) as { run_id: string };
  const run = JSON.parse(await readFile(path.join(root, 'findings/amendeor/runs', run_id, 'run.json'), 'utf8')) as { stages: Array<{ name: string; status: string }> };
  assert.deepEqual(run.stages.map((s) => [s.name, s.status]), [['patterns', 'ok'], ['contextual', 'partial']]);
});

test('an inline provider api_key in the workspace amendeor.yaml is refused with a migration message; the user config still may hold one', async () => {
  const { loadConfig } = await import('../src/config.ts');
  const root = await mkdtemp(path.join(os.tmpdir(), 'amendeor-key-'));
  await writeFile(path.join(root, 'amendeor.yaml'), 'providers: { main: { transport: openai, api_key: sk-live-123 } }\n');
  const env = { HOME: root, XDG_CONFIG_HOME: path.join(root, 'cfg') };
  await assert.rejects(loadConfig({ workspaceDir: root, env }), /workspace amendeor\.yaml: providers\.main\.api_key is no longer supported.*api_key_env/);
  await writeFile(path.join(root, 'amendeor.yaml'), 'providers: { main: { transport: openai, api_key_env: MAIN_KEY } }\n');
  await mkdir(path.join(root, 'cfg/codicora'), { recursive: true });
  await writeFile(path.join(root, 'cfg/codicora/amendeor.yaml'), 'providers: { main: { api_key: sk-live-123 } }\n');
  assert.equal((await loadConfig({ workspaceDir: root, env })).config.providers.main!.api_key, 'sk-live-123');
});
