// MANUSCRIPT.md as data (../../vectors/manuscript/): Amendeor's reader agrees with every case, or stops with its code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { readManuscript, ReaderError } from '../src/source/manuscript.ts';

const vector = fileURLToPath(new URL('../../vectors/manuscript/', import.meta.url));
const skip = !existsSync(path.join(vector, 'cases.json')) && 'the Codicora specification is not checked out next to Amendeor';

test('manuscript vector: every case reads or stops as MANUSCRIPT.md says', { skip }, async () => {
  const { cases } = JSON.parse(await readFile(path.join(vector, 'cases.json'), 'utf8')) as { cases: Array<{ name: string; error?: string; expect?: unknown }> };
  for (const c of cases) {
    const dir = path.join(vector, c.name, 'manuscript');
    if (c.error) { await assert.rejects(readManuscript(dir), (e: unknown) => e instanceof ReaderError && e.code === c.error, c.name); continue; }
    const { book } = await readManuscript(dir);
    const raw = parse(await readFile(path.join(dir, 'manuscript.yaml'), 'utf8')) as { chapters: Array<{ canon_event?: unknown }> };
    // Amendeor addresses the text before the first marker as s0 only when there is text there.
    assert.deepEqual({ language: book.lang, chapters: book.chapters.map((ch, i) => ({ slug: ch.slug, title: ch.title, file: ch.relativeFile, canon_event: [raw.chapters[i]!.canon_event ?? []].flat(), scenes: ch.scenes.filter((s) => !(s.implicit && !s.text.trim())).map((s) => s.id) })) }, c.expect, c.name);
  }
});
