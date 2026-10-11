// Независимые корпуса оценки 2026-10-11 (не использовались при разработке промптов):
//   furnace2 / furnace2-clean — Furnace Road, гл. 2 «Monday» (книга заблокирована, только чтение; три копии с ошибками + чистая);
//   ru-new / ru-new-clean      — Чехов, «Тоска» и «Анюта» (Wikisource; три копии с ошибками + чистая);
//   nonstd                     — нестандартная, но правильная проза: Чехов «Егерь», «Унтер Пришибеев»; Твен, Huckleberry Finn, гл. I.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSource } from '../../src/source/index.ts';
import { loadPack } from '../../src/lang/pack.ts';
import { planMutations, type MutationType } from '../mutate.ts';

const amendeor = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const results = path.join(amendeor, 'eval/results/2026-10-11-recall-optimization');
const sha = (text: string) => 'sha256:' + createHash('sha256').update(text).digest('hex');
const uuid = (seed: string) => { const hex = createHash('sha256').update(seed).digest('hex'); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`; };
// Та же разбивка на сцены, что в prepare-eval-fixtures.ts.
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
// Та же очистка вики-разметки, что для clean-ru (prepare-clean-fixtures.ts).
async function wikisource(file: string): Promise<string> {
  const raw = await readFile(path.join(amendeor, 'eval/sources', file), 'utf8');
  const header = raw.indexOf('\n}}');
  const ends = [raw.search(/\{\{[Пп]римечания/), raw.indexOf('[[Категория:')].filter((index) => index > header);
  // Шаблоны снимаются изнутри наружу: эпиграф «Тоски» вложен в несколько шаблонов и уходит вместе с ними.
  let body = raw.slice(header + 3, Math.min(...ends));
  for (let previous = ''; previous !== body;) { previous = body; body = body.replace(/\{\{[^{}]*\}\}/g, ''); }
  const text = body.replace(/<ref[^>]*\/>/g, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;| /g, ' ').replace(/''/g, '').replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').trim().replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n');
  if (/[{}<>[\]]/.test(text)) throw new Error(`markup left in ${file}`);
  return text;
}
type Chapter = { slug: string; title: string; text: string };
async function workspace(dir: string, id: string, language: string, chapters: Chapter[]): Promise<void> {
  await rm(dir, { recursive: true, force: true });
  await mkdir(path.join(dir, 'manuscript/chapters'), { recursive: true });
  await writeFile(path.join(dir, 'codicora.yaml'), `spec: codicora/v1\ntype: project\nproject:\n  id: ${id}\n  title: ${JSON.stringify(id)}\n  source_language: ${language}\nmanuscript:\n  path: manuscript\nedited:\n  path: edited\n`);
  let manifest = `schema_version: 1\nlanguage: ${language}\nchapters:\n`;
  for (const chapter of chapters) {
    manifest += `  - slug: ${chapter.slug}\n    title: ${JSON.stringify(chapter.title)}\n    eval_control: false\n`;
    // Глава Furnace Road уже размечена сценами — копируется как есть; остальное делится на сцены здесь.
    const body = chapter.text.includes('<!-- scene:') ? chapter.text : sceneGroups(chapter.text).map((scene, index) => `<!-- scene: ${uuid(`${id}:${chapter.slug}:${index}`)} -->\n${scene}`).join('\n\n') + '\n';
    await writeFile(path.join(dir, 'manuscript/chapters', `${chapter.slug}.md`), body);
  }
  await writeFile(path.join(dir, 'manuscript/manuscript.yaml'), manifest);
}
const manifest: Record<string, unknown> = {};
async function corpus(root: string, base: string, language: string, chapters: Chapter[], seeded: boolean, types: MutationType[], provenance: unknown): Promise<void> {
  const clean = path.join(results, `${root}-clean/corpus/${base}-clean`);
  await workspace(clean, `${base}-clean`, language, chapters);
  await writeFile(path.join(clean, 'mutations.json'), `${JSON.stringify({ provenance, control_chapter: null, mutations: [] }, null, 2)}\n`);
  manifest[`${root}-clean/${base}-clean`] = { provenance, chapters: chapters.map((chapter) => ({ slug: chapter.slug, title: chapter.title, words: chapter.text.match(/[\p{L}\p{N}]+/gu)?.length, sha256: sha(chapter.text) })) };
  if (!seeded) return;
  const source = await openSource(clean); const pack = (await loadPack(language)).pack;
  for (const seed of ['opt-s1', 'opt-s2', 'opt-s3']) {
    const fixture = { language, control_chapter: '__none__' };
    const usable = types.filter((type) => { try { planMutations(source, fixture, { spans: [] }, pack, `${base}-${seed}`, seed, false, { generator: 2, mode: 'copy', types: [type] }); return true; } catch { return false; } });
    const plan = planMutations(source, fixture, { spans: [] }, pack, `${base}-${seed}`, seed, false, { generator: 2, mode: 'copy', types: usable });
    const work = `${base}-${seed.slice(-2)}`;
    const dir = path.join(results, root, 'corpus', work);
    await workspace(dir, work, language, chapters.map((chapter) => ({ ...chapter, text: plan.chapters.get(source.book.chapters.find((item) => item.slug === chapter.slug)!.file)! })));
    await writeFile(path.join(dir, 'mutations.json'), `${JSON.stringify({ provenance, seed, generator: 2, mode: 'copy', types_used: usable, types_skipped: types.filter((type) => !usable.includes(type)), control_chapter: null, mutations: plan.mutations }, null, 2)}\n`);
    manifest[`${root}/${work}`] = { seed, mutations: plan.mutations.map((mutation) => `${mutation.type} [${mutation.policy?.join('+')}]: ${JSON.stringify(mutation.original)} → ${JSON.stringify(mutation.mutated)}`) };
  }
}

// A. Furnace Road, глава 2 (сцены книги копируются как есть).
const book = path.resolve(amendeor, '../books/bradshaw-01');
const yaml = await readFile(path.join(book, 'manuscript/manuscript.yaml'), 'utf8');
if (!/- slug: ch-fd275ad0\n\s+title: "Monday"/.test(yaml)) throw new Error('chapter 2 is not "Monday"');
const monday = await readFile(path.join(book, 'manuscript/chapters/ch-fd275ad0.md'), 'utf8');
const en: MutationType[] = ['typo', 'doubled-word', 'agreement', 'redundancy', 'qualifier', 'sentence-frame', 'formulaic', 'dialogue-format'];
await corpus('furnace2', 'furnace2', 'en', [{ slug: 'ch-fd275ad0', title: 'Monday', text: monday }], true, en, { source: 'books/bradshaw-01/manuscript/chapters/ch-fd275ad0.md', sha256: sha(monday), note: 'locked book, read only' });
// B. Чехов, «Тоска» и «Анюта».
const ru: MutationType[] = ['typo', 'doubled-word', 'agreement', 'redundancy', 'qualifier', 'sentence-frame', 'formulaic', 'dialogue-format'];
const toska = await wikisource('toska.wiki.txt'), anyuta = await wikisource('anyuta.wiki.txt');
await corpus('ru-new', 'ru-new', 'ru', [{ slug: '01-toska', title: 'Тоска', text: toska }, { slug: '02-anyuta', title: 'Анюта', text: anyuta }], true, ru,
  { note: 'Wikisource templates removed, including the epigraph of «Тоска»', sources: { 'eval/sources/toska.wiki.txt': sha(await readFile(path.join(amendeor, 'eval/sources/toska.wiki.txt'), 'utf8')), 'eval/sources/anyuta.wiki.txt': sha(await readFile(path.join(amendeor, 'eval/sources/anyuta.wiki.txt'), 'utf8')) }, rights: 'Chekhov (d. 1904), PD' });
// E. Нестандартная правильная проза — только чистые контроли.
const eger = await wikisource('eger.wiki.txt'), prishibeev = await wikisource('prishibeev.wiki.txt');
await corpus('nonstd', 'nonstd-ru', 'ru', [{ slug: '01-eger', title: 'Егерь', text: eger }, { slug: '02-prishibeev', title: 'Унтер Пришибеев', text: prishibeev }], false, [], { sources: ['eval/sources/eger.wiki.txt', 'eval/sources/prishibeev.wiki.txt'], rights: 'Chekhov (d. 1904), PD' });
const huck = (await readFile(path.join(amendeor, 'eval/sources/huckleberry-finn-pg76.txt'), 'utf8')).replace(/\r\n?/g, '\n');
const body = huck.slice(huck.indexOf('*** START OF THE PROJECT GUTENBERG EBOOK'));
const first = body.indexOf('\nCHAPTER I.\n', body.indexOf('\nCHAPTER I.\n') + 1), second = body.indexOf('\nCHAPTER II.\n', first);
const chapterOne = body.slice(first + '\nCHAPTER I.\n'.length, second).trim().split(/\n\s*\n/).map((paragraph) => paragraph.trim().replace(/\n/g, ' ')).join('\n\n');
await corpus('nonstd', 'nonstd-en', 'en', [{ slug: '01-huck', title: 'Chapter I', text: chapterOne }], false, [], { source: 'eval/sources/huckleberry-finn-pg76.txt (Project Gutenberg #76)', sha256: sha(huck), rights: 'public domain' });
await writeFile(path.join(results, 'corpora.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));
