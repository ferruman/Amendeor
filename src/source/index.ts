import path from 'node:path';
import { stat } from 'node:fs/promises';
import { openWorkspace } from './workspace.ts';
import { readStandalone } from './standalone.ts';
import type { Book } from '../book.ts';

export interface OpenedSource { book: Book; kind: 'workspace' | 'standalone'; editedDir: string; stateDir: string; manifestText?: string; manuscriptDir?: string; workspaceDir?: string; findingsDir?: string; warnings: string[] }

export async function openSource(target: string, opts: { lang?: string; out?: string } = {}): Promise<OpenedSource> {
  const absolute = path.resolve(target);
  const info = await stat(absolute).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (info?.isFile() && /\.(md|txt)$/i.test(absolute)) return standaloneSource(absolute, opts);
  const workspace = await openWorkspace(absolute);
  if (workspace) return { ...workspace, kind: 'workspace', workspaceDir: path.dirname(workspace.manifestPath), stateDir: path.join(path.dirname(workspace.manifestPath), '.codicora', 'amendeor') };
  return standaloneSource(absolute, opts);
}

async function standaloneSource(absolute: string, opts: { lang?: string; out?: string }) {
  const book = await readStandalone(absolute, opts.lang);
  const editedDir = path.resolve(opts.out ?? `${absolute}.amendeor`);
  return { book, kind: 'standalone' as const, editedDir, stateDir: path.join(editedDir, '.codicora', 'amendeor'), warnings: [] };
}
