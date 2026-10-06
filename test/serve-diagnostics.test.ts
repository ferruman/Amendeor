import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { Server } from 'node:http';
import { createServer } from '../src/serve.ts';
import { openSource } from '../src/source/index.ts';
import { makeProposal } from '../src/proposal/identity.ts';
import { writeRun } from '../src/run/store.ts';

// Проверяем обработчик без сетевого порта и без модельных вызовов.
function call(server: Server, url: string, body?: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve) => {
    const request = Object.assign(Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []), { url, method: body ? 'POST' : 'GET', headers: {} });
    let status: number;
    let headers: Record<string, string>;
    server.emit('request', request, {
      writeHead(code: number, values: Record<string, string>) { status = code; headers = values; },
      end(value: string) { resolve({ status, body: headers['content-type']?.includes('json') ? JSON.parse(value) : value }); }
    });
  });
}

test('review reports conflicting and stale accepted edits, including previous runs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'amendeor-diagnostics-'));
  const oldConfig = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = join(root, 'no-config');
  try {
    await mkdir(join(root, 'manuscript/chapters'), { recursive: true });
    await writeFile(join(root, 'codicora.yaml'), 'project:\n  id: demo\n');
    await writeFile(join(root, 'manuscript/manuscript.yaml'), 'schema_version: 1\nlanguage: en\nchapters:\n  - slug: one\n    title: One\n');
    const file = join(root, 'manuscript/chapters/one.md');
    await writeFile(file, '<!-- scene: s1 -->\nThe lanterns counted twice.\n');
    const source = await openSource(root, {});
    const proposals = [
      makeProposal({ category: 'word-choice', chapter: 'one', scene: 's1', target: 'lanterns counted', replacement: 'lanterns tallied' }),
      makeProposal({ category: 'clarity', chapter: 'one', scene: 's1', target: 'counted twice', replacement: 'counted once' }),
    ];
    await writeRun(source.stateDir, 'first', { 'proposals.jsonl': proposals.map((p) => JSON.stringify(p)).join('\n') });
    const server = createServer({ library: join(root, 'none'), workspaces: [root] });
    assert.equal((await call(server, '/api/docs/ws-0/accept', { ids: proposals.map((p) => p.id) })).status, 200);
    let view = (await call(server, '/api/docs/ws-0')).body;
    assert.deepEqual(view.proposals.map((p: { status: string }) => p.status), ['accepted', 'conflict']);
    assert.match((await call(server, '/api/docs/ws-0/edited')).body, /lanterns tallied twice/);
    await writeRun(source.stateDir, 'second', { 'proposals.jsonl': '' });
    await writeFile(file, '<!-- scene: s1 -->\nThe lamps went out.\n');
    view = (await call(server, '/api/docs/ws-0')).body;
    assert.deepEqual(view.proposals.map((p: { status: string }) => p.status), ['stale', 'stale']);
    assert.match((await call(server, '/api/docs/ws-0/edited')).body, /The lamps went out/);
  } finally {
    if (oldConfig === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = oldConfig;
    await rm(root, { recursive: true, force: true });
  }
});
