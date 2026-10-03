import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createServer } from '../src/serve.ts';

test('ui server: add a text, run the rules, accept an edit, download the edited copy', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'amendeor-serve-'));
  process.env.XDG_CONFIG_HOME = path.join(root, 'no-user-config');
  const server = createServer({ library: path.join(root, 'library'), workspaces: [] });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (url: string, body?: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(base + url, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } });
    return { status: response.status, body: response.headers.get('content-type')!.includes('json') ? await response.json() as any : await response.text() };
  };
  try {
    const created = await call('/api/docs', { name: 'Short story', lang: 'en', files: [{ name: 'one.md', text: 'She said said yes.\n' }] });
    assert.equal(created.status, 201);
    const id = created.body.id as string;
    assert.equal((await call(`/api/docs/${id}/run`, { mode: 'mechanical' })).status, 202);
    let view = (await call(`/api/docs/${id}`)).body;
    for (let tries = 0; view.job && tries < 100; tries++) { await new Promise((resolve) => setTimeout(resolve, 50)); view = (await call(`/api/docs/${id}`)).body; }
    assert.equal(view.job, null);
    const pending = view.proposals.find((item: { status: string }) => item.status === 'pending');
    assert.ok(pending, 'the rules propose an edit');
    assert.equal(view.chapters[0].text.slice(pending.start, pending.end), pending.target);
    assert.equal((await call(`/api/docs/${id}/accept`, { ids: [pending.id] }, { origin: 'http://evil.example' })).status, 403);
    assert.equal((await call(`/api/docs/${id}/accept`, { ids: [pending.id] })).status, 200);
    view = (await call(`/api/docs/${id}`)).body;
    assert.equal(view.proposals.find((item: { id: string }) => item.id === pending.id).status, 'accepted');
    const edited = await call(`/api/docs/${id}/edited`);
    assert.match(edited.body, /She said yes\./);
  } finally { server.close(); }
});
