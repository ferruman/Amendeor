import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const run = promisify(execFile);
const root = await mkdtemp(path.join(os.tmpdir(), 'amendeor-perf-'));
await mkdir(path.join(root, 'manuscript/chapters'), { recursive: true });
await writeFile(path.join(root, 'codicora.yaml'), 'spec: codicora/v1\ntype: project\nmanuscript: { path: manuscript }\n');
await writeFile(path.join(root, 'manuscript/manuscript.yaml'), 'schema_version: 1\nlanguage: en\nchapters: [{ slug: long, title: Long }]\n');
const sentence = 'The quiet morning brought clear light to every stone along the river bank.';
const wordCount = sentence.match(/[\p{L}]+/gu)!.length;
const sceneWords = 1000;
const sceneCount = 120;
const scenes = Array.from({ length: sceneCount }, (_, index) => `<!-- scene: scene-${String(index).padStart(3, '0')} -->\n${Array(Math.ceil(sceneWords / wordCount)).fill(sentence).join(' ')}\n`);
await writeFile(path.join(root, 'manuscript/chapters/long.md'), scenes.join('\n'));
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const env = { PATH: process.env.PATH, HOME: root, XDG_CONFIG_HOME: path.join(root, 'no-user-config') };
const timings: number[] = [];
for (let index = 0; index < 2; index++) {
  const start = performance.now();
  await run(process.execPath, [cli, 'edit', root, '--mode', 'mechanical', '--json'], { env, maxBuffer: 4 * 1024 * 1024 });
  timings.push((performance.now() - start) / 1000);
}
process.stdout.write(`${JSON.stringify({ words: sceneCount * Math.ceil(sceneWords / wordCount) * wordCount, cold_seconds: timings[0], warm_seconds: timings[1], cold_under_10s: timings[0]! < 10, warm_under_2s: timings[1]! < 2 }, null, 2)}\n`);
