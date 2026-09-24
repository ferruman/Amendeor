import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cp, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import { readManuscript, ReaderError } from '../src/source/manuscript.ts';
import { readStandalone } from '../src/source/standalone.ts';
import { openSource } from '../src/source/index.ts';
import { buildEdited } from '../src/edited/build.ts';

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

test('workspace reader follows manifest order, preserves scenes, and warns on implicit opening', async () => {
  const result = await readManuscript(path.join(fixtures, 'workspace-min/manuscript'));
  assert.deepEqual(result.book.chapters.map((chapter) => chapter.slug), ['first', 'second']);
  assert.equal(result.book.chapters[0]!.scenes[0]!.id, 's0');
  assert.equal(result.book.chapters[0]!.scenes[0]!.implicit, true);
  assert.ok(result.warnings.some((warning) => warning.startsWith('text-before-first-marker')));
  assert.equal(result.book.chapters[0]!.scenes[1]!.id, '11111111-1111-4111-8111-111111111111');
});

test('each reader error fixture returns its documented code', async () => {
  for (const code of ['manifest-missing', 'manifest-invalid', 'chapter-file-missing', 'duplicate-scene-id'] as const) {
    await assert.rejects(readManuscript(path.join(fixtures, `workspace-errors/${code}/manuscript`)), (error: unknown) => error instanceof ReaderError && error.code === code);
  }
});

test('standalone file and directory inputs have stable implicit and marked scene ids', async () => {
  const one = await readStandalone(path.join(fixtures, 'standalone/one.md'), 'en');
  assert.equal(one.chapters[0]!.scenes[0]!.id, 'standalone-scene');
  const dir = await readStandalone(path.join(fixtures, 'standalone/dir'), 'en');
  assert.deepEqual(dir.chapters.map((chapter) => chapter.slug), ['01', '02']);
  assert.deepEqual(dir.chapters.map((chapter) => chapter.scenes[0]!.id), ['s0', 'scene-two']);
  await assert.rejects(readStandalone(path.join(fixtures, 'standalone/one.md')), /--lang/);
});

test('an explicit Markdown file inside a workspace is standalone input', async () => {
  const file = path.join(fixtures, 'workspace-min/manuscript/chapters/first.md');
  const source = await openSource(file, { lang: 'en' });
  assert.equal(source.kind, 'standalone');
  assert.equal(source.book.chapters.length, 1);
  assert.equal(source.book.chapters[0]!.file, file);
});

test('edited directory reads as the same manuscript structure', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'amendeor-source-'));
  await cp(path.join(fixtures, 'workspace-min'), workspace, { recursive: true });
  const source = await openSource(workspace);
  assert.equal(source.kind, 'workspace');
  await buildEdited({ book: source.book, editedDir: source.editedDir, accepted: [], manifestText: source.manifestText });
  const edited = await openSource(source.editedDir);
  assert.deepEqual(source.book.chapters.map((chapter) => [chapter.slug, chapter.scenes.map((scene) => scene.id)]), edited.book.chapters.map((chapter) => [chapter.slug, chapter.scenes.map((scene) => scene.id)]));
});
