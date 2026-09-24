import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.ts';

test('configuration merges defaults, user, workspace, environment, and CLI in order', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'amendeor-config-'));
  const xdg = path.join(root, 'xdg'); const workspace = path.join(root, 'workspace');
  await mkdir(path.join(xdg, 'codicora'), { recursive: true }); await mkdir(workspace);
  await writeFile(path.join(xdg, 'codicora/amendeor.yaml'), 'language: en\nnormalize: { yo: keep }\n');
  await writeFile(path.join(workspace, 'amendeor.yaml'), 'language: ru\nnormalize: { yo: e }\n');
  const loaded = await loadConfig({ workspaceDir: workspace, env: { XDG_CONFIG_HOME: xdg, HOME: root, AMENDEOR_NORMALIZE__YO: 'yo', AMENDEOR_LANGUAGE: 'en' }, cli: { language: 'ru' } });
  assert.equal(loaded.config.language, 'ru');
  assert.equal(loaded.config.normalize.yo, 'yo');
  assert.equal(loaded.winningLayer.language, 'cli');
  assert.equal(loaded.winningLayer['normalize.yo'], 'environment');
  assert.equal(loaded.winningLayer['normalize.ellipsis'], 'defaults');
});

test('placeholder and invalid HTTP header keys name their config field', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'amendeor-keys-'));
  const file = path.join(root, 'config.yaml');
  await writeFile(file, 'providers: { main: { transport: openai, api_key: "<paste-key-here>" } }\n');
  await assert.rejects(loadConfig({ env: { AMENDEOR_CONFIG: file, XDG_CONFIG_HOME: path.join(root, 'absent'), HOME: root } }), /providers\.main\.api_key/);
  await writeFile(file, 'providers: { main: { transport: openai, api_key: "ключ" } }\n');
  await assert.rejects(loadConfig({ env: { AMENDEOR_CONFIG: file, XDG_CONFIG_HOME: path.join(root, 'absent'), HOME: root } }), /HTTP header/);
});

test('missing user configuration stays isolated from the real home directory', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'amendeor-emptyconfig-'));
  const loaded = await loadConfig({ env: { XDG_CONFIG_HOME: path.join(root, 'does-not-exist'), HOME: root } });
  assert.deepEqual(loaded.config.auto_accept, []);
  assert.deepEqual(loaded.config.providers, {});
});
