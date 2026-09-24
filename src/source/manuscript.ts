import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { splitScenes, type Book, type Chapter } from '../book.ts';

export class ReaderError extends Error {
  readonly code: 'manifest-missing' | 'manifest-invalid' | 'chapter-file-missing' | 'duplicate-scene-id';
  constructor(code: 'manifest-missing' | 'manifest-invalid' | 'chapter-file-missing' | 'duplicate-scene-id', detail: string) { super(`${code}: ${detail}`); this.code = code; this.name = 'ReaderError'; }
}
export interface ReadManuscript { book: Book; manifestText: string; manifestPath: string; warnings: string[] }

export async function readManuscript(dir: string): Promise<ReadManuscript> {
  const manifestPath = path.join(dir, 'manuscript.yaml');
  let manifestText: string;
  try { manifestText = await readFile(manifestPath, 'utf8'); }
  catch { throw new ReaderError('manifest-missing', manifestPath); }
  let data: unknown;
  try { data = parse(manifestText); } catch (error) { throw new ReaderError('manifest-invalid', (error as Error).message); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ReaderError('manifest-invalid', 'expected a YAML mapping');
  const manifest = data as Record<string, unknown>;
  if (manifest.schema_version !== 1 || typeof manifest.language !== 'string' || !Array.isArray(manifest.chapters)) throw new ReaderError('manifest-invalid', 'schema_version must be 1, with language and chapters');
  const slugs = new Set<string>();
  const warnings: string[] = [];
  const chapters: Chapter[] = [];
  for (const value of manifest.chapters) {
    if (!value || typeof value !== 'object') throw new ReaderError('manifest-invalid', 'chapter entry must be a mapping');
    const item = value as Record<string, unknown>;
    if (typeof item.slug !== 'string' || !item.slug || typeof item.title !== 'string' || slugs.has(item.slug)) throw new ReaderError('manifest-invalid', `invalid or duplicate chapter slug: ${String(item.slug)}`);
    slugs.add(item.slug);
    const relative = typeof item.file === 'string' ? item.file : `chapters/${item.slug}.md`;
    const file = path.resolve(dir, relative);
    if (!file.startsWith(`${path.resolve(dir)}${path.sep}`)) throw new ReaderError('manifest-invalid', `chapter file escapes manuscript: ${relative}`);
    let text: string;
    try { text = await readFile(file, 'utf8'); } catch { throw new ReaderError('chapter-file-missing', `${item.slug}: ${file}`); }
    const scenes = splitScenes(text);
    const ids = new Set<string>();
    for (const scene of scenes) {
      if (ids.has(scene.id)) throw new ReaderError('duplicate-scene-id', `${item.slug}: ${scene.id}`);
      ids.add(scene.id);
    }
    if (scenes.some((scene) => scene.implicit && scene.id === 's0' && scene.text.trim())) warnings.push(`text-before-first-marker: ${item.slug}`);
    chapters.push({ slug: item.slug, title: item.title, file, relativeFile: relative, text, scenes });
  }
  const chapterDir = path.join(dir, 'chapters');
  try {
    for (const entry of await readdir(chapterDir)) if (entry.endsWith('.md') && !slugs.has(path.basename(entry, '.md'))) warnings.push(`chapter-not-in-manifest: ${entry}`);
  } catch { /* A manifest may use explicit files without a chapters directory. */ }
  return { book: { lang: manifest.language, chapters }, manifestText, manifestPath, warnings };
}
