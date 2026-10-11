// Независимые чистые контроли 2026-10-11 (rule safety), собраны до любого платного запуска:
//   controls — диалектный рассказ от первого лица (Twain, Huckleberry Finn, гл. II; Гоголь, «Пропавшая грамота» — сказ дьячка),
//              несобственно-прямая речь (Joyce, «Eveline»; Чехов, «Спать хочется»), имена и диалог (Чехов, «Хамелеон»).
// Регрессия идёт на корпусах 2026-10-11-recall-optimization: они копируются сюда как есть, с теми же мутациями.
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const amendeor = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const results = path.join(amendeor, 'eval/results/2026-10-11-rule-safety');
const previous = path.join(amendeor, 'eval/results/2026-10-11-recall-optimization');
const sha = (text: string) => 'sha256:' + createHash('sha256').update(text).digest('hex');
const uuid = (seed: string) => { const hex = createHash('sha256').update(seed).digest('hex'); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`; };
// Разбивка на сцены и очистка вики-разметки — те же, что в prepare-recall-optimization.ts.
function sceneGroups(text: string, limit = 700): string[] {
  const paragraphs = text.trim().split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const groups: string[] = []; let current: string[] = []; let count = 0;
  for (const paragraph of paragraphs) {
    const words = paragraph.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
    if (current.length && count + words > limit) { groups.push(current.join('\n\n')); current = []; count = 0; }
    current.push(paragraph); count += words;
  }
  if (current.length) groups.push(current.join('\n\n'));
  return groups;
}
async function wikisource(file: string): Promise<string> {
  const raw = await readFile(path.join(amendeor, 'eval/sources', file), 'utf8');
  // Шаблоны (и шапка «Отексте» с вложенными) снимаются изнутри наружу по всему файлу, потом текст режется до категорий.
  let body = raw;
  for (let previous = ''; previous !== body;) { previous = body; body = body.replace(/\{\{[^{}]*\}\}/g, ''); }
  const ends = [body.indexOf('[[Категория:'), body.search(/\n== ?Примечания/)].filter((index) => index >= 0);
  body = body.slice(0, Math.min(...ends));
  const text = body.replace(/<ref[^>]*\/>/g, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;| /g, ' ').replace(/'''?/g, '').replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/^=+[^=\n]*=+$/gm, '').trim().replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n');
  if (/[{}<>[\]]/.test(text)) throw new Error(`markup left in ${file}`);
  return text;
}
const gutenberg = (raw: string, from: string, to: string) => { const body = raw.replace(/\r\n?/g, '\n'); const start = body.indexOf(from, body.indexOf('*** START OF')); const end = body.indexOf(to, start + from.length);
  if (start < 0 || end < 0) throw new Error(`bounds not found: ${from}`); return body.slice(start + from.length, end).trim().split(/\n\s*\n/).map((paragraph) => paragraph.trim().replace(/\n/g, ' ')).join('\n\n'); };

const manifest: Record<string, unknown> = {};
async function work(root: string, id: string, language: string, chapters: Array<{ slug: string; title: string; text: string }>, provenance: unknown): Promise<void> {
  const dir = path.join(results, root, 'corpus', id);
  await rm(dir, { recursive: true, force: true });
  await mkdir(path.join(dir, 'manuscript/chapters'), { recursive: true });
  await writeFile(path.join(dir, 'codicora.yaml'), `spec: codicora/v1\ntype: project\nproject:\n  id: ${id}\n  title: ${JSON.stringify(id)}\n  source_language: ${language}\nmanuscript:\n  path: manuscript\nedited:\n  path: edited\n`);
  let yaml = `schema_version: 1\nlanguage: ${language}\nchapters:\n`;
  for (const chapter of chapters) {
    yaml += `  - slug: ${chapter.slug}\n    title: ${JSON.stringify(chapter.title)}\n    eval_control: false\n`;
    await writeFile(path.join(dir, 'manuscript/chapters', `${chapter.slug}.md`), sceneGroups(chapter.text).map((scene, index) => `<!-- scene: ${uuid(`${id}:${chapter.slug}:${index}`)} -->\n${scene}`).join('\n\n') + '\n');
  }
  await writeFile(path.join(dir, 'manuscript/manuscript.yaml'), yaml);
  await writeFile(path.join(dir, 'mutations.json'), `${JSON.stringify({ provenance, control_chapter: null, mutations: [] }, null, 2)}\n`);
  manifest[`${root}/${id}`] = { provenance, chapters: chapters.map((chapter) => ({ slug: chapter.slug, title: chapter.title, words: chapter.text.match(/[\p{L}\p{N}]+/gu)?.length, sha256: sha(chapter.text) })) };
}

const huck = await readFile(path.join(amendeor, 'eval/sources/huckleberry-finn-pg76.txt'), 'utf8');
const huckBody = huck.replace(/\r\n?/g, '\n'); const firstII = huckBody.indexOf('\nCHAPTER II.\n'); const realII = huckBody.indexOf('\nCHAPTER II.\n', firstII + 1);
const huck2 = gutenberg(huckBody.slice(realII - 1), '\nCHAPTER II.\n', '\nCHAPTER III.\n');
await work('controls', 'huck2-en', 'en', [{ slug: '01-huck2', title: 'Chapter II', text: huck2 }], { source: 'eval/sources/huckleberry-finn-pg76.txt (Project Gutenberg #76), chapter II', kind: 'first-person dialect narration', rights: 'public domain' });
const dubliners = await readFile(path.join(amendeor, 'eval/sources/dubliners-pg2814.txt'), 'utf8');
await work('controls', 'eveline-en', 'en', [{ slug: '01-eveline', title: 'Eveline', text: gutenberg(dubliners, '\nEVELINE\n', '\nAFTER THE RACE\n') }], { source: 'eval/sources/dubliners-pg2814.txt (Project Gutenberg #2814), «Eveline»', kind: 'free indirect discourse', rights: 'public domain' });
await work('controls', 'spat-ru', 'ru', [{ slug: '01-spat', title: 'Спать хочется', text: await wikisource('spat-hochetsya.wiki.txt') }], { source: 'eval/sources/spat-hochetsya.wiki.txt (Wikisource)', kind: 'free indirect discourse', rights: 'Chekhov (d. 1904), PD' });
await work('controls', 'gramota-ru', 'ru', [{ slug: '01-gramota', title: 'Пропавшая грамота', text: await wikisource('propavshaya-gramota.wiki.txt') }], { source: 'eval/sources/propavshaya-gramota.wiki.txt (Wikisource)', kind: 'first-person skaz with dialect and period forms', rights: 'Gogol (d. 1852), PD' });
await work('controls', 'hameleon-ru', 'ru', [{ slug: '01-hameleon', title: 'Хамелеон', text: await wikisource('hameleon.wiki.txt') }], { source: 'eval/sources/hameleon.wiki.txt (Wikisource, ПСС 1974—1982)', kind: 'proper names, ranks and dialogue', rights: 'Chekhov (d. 1904), PD' });

// Регрессия: прежние корпуса с теми же мутациями и метками.
for (const root of ['furnace2', 'ru-new', 'furnace2-clean', 'ru-new-clean', 'nonstd-clean']) {
  await rm(path.join(results, root, 'corpus'), { recursive: true, force: true });
  await cp(path.join(previous, root, 'corpus'), path.join(results, root, 'corpus'), { recursive: true });
  await cp(path.join(previous, root, 'labels-stage-b.json'), path.join(results, root, 'labels-stage-b.json')).catch(() => undefined);
  manifest[root] = { copied_from: `eval/results/2026-10-11-recall-optimization/${root}/corpus` };
}
await writeFile(path.join(results, 'corpora.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));
