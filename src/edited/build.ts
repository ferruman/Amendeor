import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import type { Book, Chapter } from '../book.ts';
import { locate } from '../proposal/locate.ts';
import type { Proposal } from '../proposal/schema.ts';
import type { Acceptance } from './decisions.ts';

export type BuildStatus = 'applied' | 'moved' | 'stale' | 'conflict';
export interface BuildResult { id: string; chapter: string; scene: string; status: BuildStatus; detail?: string }
export interface BuildInput { book: Book; editedDir: string; accepted: Acceptance[] | Proposal[]; manifestText?: string }

export async function buildEdited(input: BuildInput): Promise<BuildResult[]> {
  const outputRoot = path.resolve(input.editedDir);
  const destinations = new Map<string, string>();
  for (const chapter of input.book.chapters) {
    const sourceFile = path.resolve(chapter.file);
    if (sourceFile === outputRoot || sourceFile.startsWith(`${outputRoot}${path.sep}`)) {
      throw new Error(`source chapter is inside edited directory: ${sourceFile}`);
    }
    const relative = chapterRelativePath(chapter);
    const destination = path.resolve(outputRoot, relative);
    if (!destination.startsWith(`${outputRoot}${path.sep}`)) throw new Error(`chapter path escapes edited directory: ${relative}`);
    destinations.set(chapter.slug, destination);
  }
  const previousManifest = await readFile(path.join(outputRoot, 'manuscript.yaml'), 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  const accepted = input.accepted.map((item) => 'proposal' in item ? item.proposal : item);
  const results: BuildResult[] = [];
  const found = new Set<string>();
  const chapterOutput = new Map<string, string>();
  for (const chapter of input.book.chapters) {
    const edits: Array<{ proposal: Proposal; start: number; end: number; replacement: string; status: 'applied' | 'moved' }> = [];
    for (const proposal of accepted.filter((item) => item.location.chapter === chapter.slug)) {
      found.add(proposal.id);
      const scene = chapter.scenes.find((item) => item.id === proposal.location.scene);
      if (!scene) { results.push({ id: proposal.id, chapter: chapter.slug, scene: proposal.location.scene, status: 'stale', detail: 'scene missing' }); continue; }
      const located = locate(scene.text, { ...proposal.target, replacement: proposal.replacement });
      if ('stale' in located) { results.push({ id: proposal.id, chapter: chapter.slug, scene: scene.id, status: 'stale' }); continue; }
      if ('ambiguous' in located) { results.push({ id: proposal.id, chapter: chapter.slug, scene: scene.id, status: 'conflict', detail: 'ambiguous target' }); continue; }
      edits.push({ proposal, start: scene.start + located.start, end: scene.start + located.end, replacement: proposal.replacement, status: located.moved ? 'moved' : 'applied' });
    }
    edits.sort((a, b) => a.start - b.start || a.end - b.end);
    let lastAcceptedEnd = -1;
    const applicable: typeof edits = [];
    for (const edit of edits) {
      if (edit.start < lastAcceptedEnd) {
        results.push({ id: edit.proposal.id, chapter: chapter.slug, scene: edit.proposal.location.scene, status: 'conflict', detail: 'overlaps an earlier accepted edit' });
      } else {
        applicable.push(edit); lastAcceptedEnd = edit.end;
        results.push({ id: edit.proposal.id, chapter: chapter.slug, scene: edit.proposal.location.scene, status: edit.status });
      }
    }
    let output = chapter.text;
    for (const edit of [...applicable].reverse()) output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end);
    chapterOutput.set(chapter.slug, output);
  }
  for (const proposal of accepted) if (!found.has(proposal.id)) results.push({ id: proposal.id, chapter: proposal.location.chapter, scene: proposal.location.scene, status: 'stale', detail: 'chapter missing' });
  const chaptersDir = path.join(outputRoot, 'chapters');
  await mkdir(chaptersDir, { recursive: true });
  for (const chapter of input.book.chapters) {
    await writeIfChanged(destinations.get(chapter.slug)!, chapterOutput.get(chapter.slug)!);
  }
  const manifestText = input.manifestText ?? standaloneManifest(input.book);
  await writeIfChanged(path.join(outputRoot, 'manuscript.yaml'), manifestText);
  const decisionRecords = input.accepted.map((item) => 'proposal' in item ? item : { proposal: item, accepted_by: 'author', at: new Date().toISOString() });
  await createIfMissing(path.join(outputRoot, 'accepted.jsonl'), decisionRecords);
  const expectedFiles = new Set(destinations.values());
  for (const previous of listedChapterPaths(previousManifest)) {
    const oldFile = path.resolve(outputRoot, previous);
    if (oldFile.startsWith(`${outputRoot}${path.sep}`) && !expectedFiles.has(oldFile)) await rm(oldFile, { force: true });
  }
  const expected = new Set(input.book.chapters.map((chapter) => chapterRelativePath(chapter)));
  for (const name of await readdir(chaptersDir)) if (name.endsWith('.md') && !expected.has(`chapters/${name}`)) await rm(path.join(chaptersDir, name), { force: true });
  return results;
}

function chapterRelativePath(chapter: Chapter): string {
  return chapter.relativeFile ?? `chapters/${chapter.slug}.md`;
}

function listedChapterPaths(manifestText?: string): string[] {
  if (!manifestText) return [];
  try {
    const manifest = parse(manifestText) as { chapters?: Array<{ slug?: unknown; file?: unknown }> };
    if (!Array.isArray(manifest?.chapters)) return [];
    return manifest.chapters.flatMap((chapter) => {
      if (!chapter || typeof chapter.slug !== 'string') return [];
      const relative = typeof chapter.file === 'string' ? chapter.file : `chapters/${chapter.slug}.md`;
      return relative.endsWith('.md') ? [relative] : [];
    });
  } catch { return []; }
}

function standaloneManifest(book: Book): string {
  return `schema_version: 1\nlanguage: ${JSON.stringify(book.lang)}\nchapters:\n${book.chapters.map((chapter) => `  - slug: ${JSON.stringify(chapter.slug)}\n    title: ${JSON.stringify(chapter.title)}\n`).join('')}`;
}

async function writeIfChanged(file: string, contents: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  try { if (await readFile(file, 'utf8') === contents) return; } catch { /* new file */ }
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, contents, 'utf8');
  await rename(temporary, file);
}

async function createIfMissing(file: string, accepted: Acceptance[]): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const contents = accepted.map((record) => JSON.stringify(record)).join('\n') + (accepted.length ? '\n' : '');
  try { await readFile(file); } catch { await writeFile(file, contents, { flag: 'wx' }); }
}
