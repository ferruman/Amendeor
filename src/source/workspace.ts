import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import type { Book, Chapter } from '../book.ts';
import { readManuscript } from './manuscript.ts';

export interface WorkspaceSource { book: Book; manifestPath: string; manifestText: string; manuscriptDir: string; editedDir: string; findingsDir: string; warnings: string[] }

export async function openWorkspace(target: string): Promise<WorkspaceSource | null> {
  const requestedPath = path.resolve(target);
  let candidate = path.resolve(target);
  try { if ((await (await import('node:fs/promises')).stat(candidate)).isFile()) candidate = path.dirname(candidate); } catch { /* handled below */ }
  for (;;) {
    const manifestPath = path.join(candidate, 'codicora.yaml');
    try { await access(manifestPath); } catch {
      const parent = path.dirname(candidate);
      if (parent === candidate) return null;
      candidate = parent;
      continue;
    }
    let data: unknown;
    let workspaceManifestText = '';
    try { workspaceManifestText = await readFile(manifestPath, 'utf8'); data = parse(workspaceManifestText); }
    catch (error) { throw { code: 'manifest-invalid', detail: `codicora.yaml: ${(error as Error).message}` }; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw { code: 'manifest-invalid', detail: 'codicora.yaml must be a mapping' };
    const record = data as Record<string, unknown>;
    const folder = (key: string, fallback: string) => {
      const value = (record[key] as { path?: unknown } | undefined)?.path;
      return typeof value === 'string' ? path.resolve(candidate, value) : path.resolve(candidate, fallback);
    };
    const sourceManuscriptDir = folder('manuscript', 'manuscript');
    const editedDir = folder('edited', 'edited');
    const isEditedInput = requestedPath === editedDir || requestedPath.startsWith(`${editedDir}${path.sep}`);
    const manuscriptDir = isEditedInput ? editedDir : sourceManuscriptDir;
    const result = await readManuscript(manuscriptDir);
    return { ...result, manifestPath, manuscriptDir, editedDir, findingsDir: folder('findings', 'findings') };
  }
}
