import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { splitScenes, type Book, type Chapter } from '../book.ts';

export async function readStandalone(target: string, lang?: string): Promise<Book> {
  if (!lang) throw new Error('standalone input requires --lang');
  const info = await stat(target);
  const files = info.isDirectory()
    ? (await readdir(target)).filter((name) => /\.(md|txt)$/i.test(name)).sort().map((name) => path.join(target, name))
    : [target];
  const chapters: Chapter[] = [];
  for (const file of files) {
    if (!/\.(md|txt)$/i.test(file)) throw new Error(`unsupported standalone file: ${file}`);
    const text = await readFile(file, 'utf8');
    chapters.push({ slug: path.basename(file, path.extname(file)), title: path.basename(file, path.extname(file)), file, text, scenes: splitScenes(text) });
  }
  return { lang, chapters };
}
