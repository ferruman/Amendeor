import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readManuscript } from '../src/source/manuscript.ts';
import { makeProposal } from '../src/proposal/identity.ts';
import { buildEdited } from '../src/edited/build.ts';
import { acceptProposals, readAccepted, rejectProposals, readRejected, DecisionError } from '../src/edited/decisions.ts';

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/workspace-min/manuscript');
const temp = async () => mkdtemp(path.join(os.tmpdir(), 'amendeor-build-'));
const execFileAsync = promisify(execFile);

test('build copies all chapters unchanged when nothing is accepted', async () => {
  const source = await readManuscript(fixture); const out = await temp();
  await buildEdited({ book: source.book, editedDir: out, accepted: [], manifestText: source.manifestText });
  for (const chapter of source.book.chapters) assert.equal(await readFile(path.join(out, 'chapters', `${chapter.slug}.md`), 'utf8'), chapter.text);
  assert.equal(await readFile(path.join(out, 'manuscript.yaml'), 'utf8'), source.manifestText);
});

test('accept and build apply a target, survive unrelated source edits, and mark removed targets stale', async () => {
  const source = await readManuscript(fixture); const out = await temp();
  const chapter = source.book.chapters[0]!; const scene = chapter.scenes.find((item) => item.id.startsWith('1111'))!;
  const target = 'The lanterns counted twice.';
  const proposal = makeProposal({ category: 'redundancy', chapter: chapter.slug, scene: scene.id, target, replacement: 'The lanterns were counted twice.', before: '', after: ' The lanterns counted twice.', occurrence: 0 });
  const accepted = await acceptProposals(out, [proposal]);
  let results = await buildEdited({ book: source.book, editedDir: out, accepted, manifestText: source.manifestText });
  assert.equal(results[0]!.status, 'applied');
  assert.equal(await readFile(path.join(out, 'chapters', `${chapter.slug}.md`), 'utf8'), chapter.text.replace(target, 'The lanterns were counted twice.'));
  assert.equal(await readFile(path.join(out, 'chapters', 'second.md'), 'utf8'), source.book.chapters[1]!.text);
  assert.equal((await readAccepted(out)).length, 1);

  const changedSource = await readManuscript(fixture);
  changedSource.book.chapters[0]!.text = changedSource.book.chapters[0]!.text.replace('Prose before', 'New prose before');
  changedSource.book.chapters[0]!.scenes = (await import('../src/book.ts')).splitScenes(changedSource.book.chapters[0]!.text);
  results = await buildEdited({ book: changedSource.book, editedDir: out, accepted, manifestText: changedSource.manifestText });
  assert.equal(results[0]!.status, 'applied');

  const removed = await readManuscript(fixture);
  removed.book.chapters[0]!.text = removed.book.chapters[0]!.text.replaceAll(target, 'Gone.');
  removed.book.chapters[0]!.scenes = (await import('../src/book.ts')).splitScenes(removed.book.chapters[0]!.text);
  results = await buildEdited({ book: removed.book, editedDir: out, accepted, manifestText: removed.manifestText });
  assert.equal(results[0]!.status, 'stale');
});

test('overlapping edits apply the earlier target only and source files stay unchanged', async () => {
  const source = await readManuscript(fixture); const out = await temp();
  const chapter = source.book.chapters[0]!; const scene = chapter.scenes.find((item) => item.id.startsWith('1111'))!;
  const before = await readFile(chapter.file);
  const first = makeProposal({ category: 'word-choice', chapter: chapter.slug, scene: scene.id, target: 'lanterns counted', replacement: 'lanterns tallied', occurrence: 0 });
  const second = makeProposal({ category: 'clarity', chapter: chapter.slug, scene: scene.id, target: 'counted twice', replacement: 'counted once', occurrence: 0 });
  const results = await buildEdited({ book: source.book, editedDir: out, accepted: [first, second], manifestText: source.manifestText });
  assert.deepEqual(results.map((item) => item.status), ['applied', 'conflict']);
  assert.deepEqual(await readFile(chapter.file), before);
});

test('non-overlapping edits use original source offsets even when an earlier replacement grows', async () => {
  const source = await readManuscript(fixture); const out = await temp();
  const chapter = source.book.chapters[0]!; const scene = chapter.scenes.find((item) => item.id.startsWith('1111'))!;
  const first = makeProposal({ category: 'word-choice', chapter: chapter.slug, scene: scene.id, target: 'lanterns counted', replacement: 'bright lanterns were counted', occurrence: 0 });
  const second = makeProposal({ category: 'word-choice', chapter: chapter.slug, scene: scene.id, target: 'The lanterns counted twice.', replacement: 'They counted the lamps twice.', occurrence: 1 });
  const results = await buildEdited({ book: source.book, editedDir: out, accepted: [first, second], manifestText: source.manifestText });
  assert.deepEqual(results.map((result) => result.status), ['applied', 'applied']);
  const edited = await readFile(path.join(out, 'chapters', `${chapter.slug}.md`), 'utf8');
  assert.match(edited, /bright lanterns were counted twice\./);
  assert.match(edited, /They counted the lamps twice\./);
});

test('duplicate ids resolve by context or occurrence, and an invalid recorded occurrence is ambiguous', async () => {
  const source = await readManuscript(fixture); const out = await temp();
  const chapter = source.book.chapters[0]!; const scene = chapter.scenes.find((item) => item.id.startsWith('1111'))!;
  const contextual = makeProposal({ category: 'word-choice', chapter: chapter.slug, scene: scene.id, target: 'The lanterns counted twice.', replacement: 'The lamps were counted twice.', before: '', after: ' The lanterns counted twice.', occurrence: 0 });
  const byOccurrence = makeProposal({ category: 'clarity', chapter: chapter.slug, scene: scene.id, target: 'The lanterns counted twice.', replacement: 'The lamps were counted twice.', occurrence: 1 });
  let results = await buildEdited({ book: source.book, editedDir: out, accepted: [contextual], manifestText: source.manifestText });
  assert.equal(results[0]!.status, 'applied');
  results = await buildEdited({ book: source.book, editedDir: out, accepted: [byOccurrence], manifestText: source.manifestText });
  assert.equal(results[0]!.status, 'applied');
  const invalid = { ...byOccurrence, target: { ...byOccurrence.target, occurrence: 8 }, id: 'amendeor:0000000000000000' };
  results = await buildEdited({ book: source.book, editedDir: out, accepted: [invalid], manifestText: source.manifestText });
  assert.equal(results[0]!.status, 'conflict');
  assert.equal(results[0]!.detail, 'ambiguous target');
});

test('acceptance history is idempotent and conflicting revisions have a named error', async () => {
  const out = await temp();
  const proposal = makeProposal({ category: 'spelling', chapter: 'one', scene: 's0', target: 'teh', replacement: 'the' });
  const first = await acceptProposals(out, [proposal]);
  const second = await acceptProposals(out, [proposal]);
  assert.equal(first.length, 1); assert.equal(second.length, 1);
  await assert.rejects(acceptProposals(out, [{ ...proposal, replacement: 'a' }]), (error: unknown) => error instanceof DecisionError && error.code === 'conflicting-acceptance');
  await assert.rejects(acceptProposals(out, [proposal, proposal]), (error: unknown) => error instanceof DecisionError && error.code === 'duplicate-proposal-id');
});

test('deleting tool state does not change a rebuild from accepted proposals', async () => {
  const source = await readManuscript(fixture); const out = await temp();
  const chapter = source.book.chapters[0]!; const scene = chapter.scenes.find((item) => item.id.startsWith('1111'))!;
  const proposal = makeProposal({ category: 'word-choice', chapter: chapter.slug, scene: scene.id, target: 'The lanterns counted twice.', replacement: 'The lamps were counted twice.', occurrence: 0 });
  await acceptProposals(out, [proposal]);
  const accepted = await readAccepted(out);
  await buildEdited({ book: source.book, editedDir: out, accepted, manifestText: source.manifestText });
  const snapshot = async () => Promise.all(['accepted.jsonl', 'manuscript.yaml', 'chapters/first.md', 'chapters/second.md'].map((file) => readFile(path.join(out, file), 'utf8')));
  const firstBuild = await snapshot();
  const privateState = path.join(out, '.codicora/amendeor');
  await mkdir(privateState, { recursive: true }); await writeFile(path.join(privateState, 'cache'), 'discardable');
  await rm(path.join(out, '.codicora'), { recursive: true, force: true });
  await buildEdited({ book: source.book, editedDir: out, accepted: await readAccepted(out), manifestText: source.manifestText });
  assert.deepEqual(await snapshot(), firstBuild);
});

test('unverified proposals require an explicit override', async () => {
  const proposal = makeProposal({ category: 'spelling', chapter: 'one', scene: 's0', target: 'teh', replacement: 'the', unverified: true });
  await assert.rejects(acceptProposals(await temp(), [proposal]), (error: unknown) => error instanceof DecisionError && error.code === 'unverified-proposal');
  assert.equal((await acceptProposals(await temp(), [proposal], { allowUnverified: true })).length, 1);
});

test('author rejections are appended to private state with the target hash', async () => {
  const state = await temp();
  const proposal = makeProposal({ category: 'spelling', chapter: 'one', scene: 's0', target: 'teh', replacement: 'the' });
  await rejectProposals(state, [proposal]);
  const records = await readRejected(state);
  assert.equal(records.length, 1);
  assert.equal(records[0]!.proposal_id, proposal.id);
  assert.equal(records[0]!.target_hash, proposal.target.hash);
});

test('a manifest file outside chapters keeps its path in the edited copy', async () => {
  const root = await temp();
  const manuscript = path.join(root, 'manuscript');
  await mkdir(path.join(manuscript, 'prose'), { recursive: true });
  await writeFile(path.join(manuscript, 'manuscript.yaml'), 'schema_version: 1\nlanguage: en\nchapters:\n  - slug: one\n    title: One\n    file: prose/one.md\n');
  await writeFile(path.join(manuscript, 'prose/one.md'), 'Original prose.\n');
  const source = await readManuscript(manuscript);
  const editedDir = path.join(root, 'edited');
  await buildEdited({ book: source.book, editedDir, accepted: [], manifestText: source.manifestText });
  assert.equal((await readManuscript(editedDir)).book.chapters[0]!.text, 'Original prose.\n');

  await writeFile(path.join(manuscript, 'manuscript.yaml'), 'schema_version: 1\nlanguage: en\nchapters:\n  - slug: one\n    title: One\n    file: prose/renamed.md\n');
  await writeFile(path.join(manuscript, 'prose/renamed.md'), 'Renamed prose.\n');
  const changed = await readManuscript(manuscript);
  await buildEdited({ book: changed.book, editedDir, accepted: [], manifestText: changed.manifestText });
  assert.equal((await readManuscript(editedDir)).book.chapters[0]!.text, 'Renamed prose.\n');
  await assert.rejects(readFile(path.join(editedDir, 'prose/one.md')), { code: 'ENOENT' });
});

test('building from edited input cannot apply an accepted edit twice', async () => {
  const root = await temp();
  const manuscript = path.join(root, 'manuscript');
  const editedDir = path.join(root, 'edited');
  await mkdir(path.join(manuscript, 'chapters'), { recursive: true });
  await writeFile(path.join(root, 'codicora.yaml'), 'schema_version: 1\nmanuscript:\n  path: ./manuscript\nedited:\n  path: ./edited\n');
  await writeFile(path.join(manuscript, 'manuscript.yaml'), 'schema_version: 1\nlanguage: en\nchapters:\n  - slug: one\n    title: One\n');
  await writeFile(path.join(manuscript, 'chapters/one.md'), 'foo foo\n');
  const source = await readManuscript(manuscript);
  const proposal = makeProposal({ category: 'word-choice', chapter: 'one', scene: 's0', target: 'foo', replacement: 'bar', occurrence: 0 });
  const accepted = await acceptProposals(editedDir, [proposal]);
  await buildEdited({ book: source.book, editedDir, accepted, manifestText: source.manifestText });
  const edited = await readManuscript(editedDir);
  await assert.rejects(buildEdited({ book: edited.book, editedDir, accepted, manifestText: edited.manifestText }), /source chapter is inside edited directory/);
  const before = await readFile(path.join(editedDir, 'chapters/one.md'), 'utf8');
  await assert.rejects(execFileAsync(process.execPath, ['src/cli.ts', 'build', editedDir], { cwd: path.resolve('') }), /edited\/ is a read-only input/);
  assert.equal(await readFile(path.join(editedDir, 'chapters/one.md'), 'utf8'), before);
});
