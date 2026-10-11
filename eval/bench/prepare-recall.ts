// Корпуса эксперимента по полноте (2026-10-10): глава «Three Binders» из Furnace Road — чистая копия и три копии
// с внесёнными ошибками разных seed, плюс русский контроль v3. Книга только читается (она заблокирована: codicora.yaml).
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSource } from '../../src/source/index.ts';
import { loadPack } from '../../src/lang/pack.ts';
import { sha256 } from '../../src/hash.ts';
import { planMutations, type MutationType } from '../mutate.ts';

const amendeor = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const results = path.join(amendeor, 'eval/results/2026-10-10-recall');
const book = path.resolve(amendeor, '../books/bradshaw-01');
const slug = 'ch-f182cce3';

const manifest = await readFile(path.join(book, 'manuscript/manuscript.yaml'), 'utf8');
const title = /- slug: ch-f182cce3\n\s+title: "([^"]+)"/.exec(manifest)?.[1];
if (title !== 'Three Binders') throw new Error('chapter 1 is not "Three Binders"');
const chapterText = await readFile(path.join(book, 'manuscript/chapters', `${slug}.md`), 'utf8');

// Рабочая область-копия без блока content_lock: это копия для оценки, книга не меняется.
async function workspace(dir: string, id: string, text: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
  await mkdir(path.join(dir, 'manuscript/chapters'), { recursive: true });
  await writeFile(path.join(dir, 'codicora.yaml'), `spec: codicora/v1\ntype: project\nproject:\n  id: ${id}\n  title: ${JSON.stringify(id)}\n  source_language: en\nmanuscript:\n  path: manuscript\nedited:\n  path: edited\n`);
  await writeFile(path.join(dir, 'manuscript/manuscript.yaml'), `schema_version: 1\nlanguage: en\nchapters:\n  - slug: ${slug}\n    title: "Three Binders"\n    eval_control: false\n`);
  await writeFile(path.join(dir, 'manuscript/chapters', `${slug}.md`), text);
}

const pack = (await loadPack('en')).pack;
const clean = path.join(results, 'furnace-clean/corpus/furnace-clean');
await workspace(clean, 'furnace-clean', chapterText);
await writeFile(path.join(clean, 'mutations.json'), `${JSON.stringify({ source: `books/bradshaw-01/manuscript/chapters/${slug}.md`, sha256: sha256(chapterText), control_chapter: null, mutations: [] }, null, 2)}\n`);
const source = await openSource(clean);

// Виды, которые генератор умеет для английского; terminology (Hyde) и comma (proofread-only) не берутся.
const wanted: MutationType[] = ['typo', 'doubled-word', 'agreement', 'redundancy', 'qualifier', 'sentence-frame', 'formulaic', 'dialogue-format'];
const fixture = { language: 'en', control_chapter: '__none__' };
const runs = [];
for (const seed of ['recall-s1', 'recall-s2', 'recall-s3']) {
  const types = wanted.filter((type) => { try { planMutations(source, fixture, { spans: [] }, pack, `furnace-${seed}`, seed, false, { generator: 2, mode: 'copy', types: [type] }); return true; } catch { return false; } });
  const plan = planMutations(source, fixture, { spans: [] }, pack, `furnace-${seed}`, seed, false, { generator: 2, mode: 'copy', types });
  const work = `furnace-${seed.slice(-2)}`;
  const dir = path.join(results, 'furnace/corpus', work);
  await workspace(dir, work, plan.chapters.get(source.book.chapters[0]!.file)!);
  await writeFile(path.join(dir, 'mutations.json'), `${JSON.stringify({ source: `books/bradshaw-01/manuscript/chapters/${slug}.md`, sha256: sha256(chapterText), seed, generator: 2, mode: 'copy', types_used: types, types_skipped: wanted.filter((type) => !types.includes(type)), control_chapter: null, mutations: plan.mutations }, null, 2)}\n`);
  runs.push({ work, seed, mutations: plan.mutations.map((mutation) => `${mutation.type} [${mutation.policy?.join('+')}]: ${JSON.stringify(mutation.original)} → ${JSON.stringify(mutation.mutated)}`) });
}

// Русский контроль: глава-фикстура v3 «Каштанки» (там Luna не находила опечатку и согласование).
const ru = path.join(results, 'ru-v3/corpus/kashtanka-ru');
await rm(ru, { recursive: true, force: true });
await cp(path.join(amendeor, 'eval/fixtures/kashtanka-ru/mutated-v3'), ru, { recursive: true });
const v3 = JSON.parse(await readFile(path.join(amendeor, 'eval/fixtures/kashtanka-ru/mutations-v3.json'), 'utf8'));
await writeFile(path.join(ru, 'mutations.json'), `${JSON.stringify({ source: 'eval/fixtures/kashtanka-ru/mutations-v3.json', control_chapter: '03-kashtanka', mutations: v3.mutations }, null, 2)}\n`);
console.log(JSON.stringify({ chapter: { slug, title, words: chapterText.match(/[\p{L}\p{N}]+/gu)?.length, sha256: sha256(chapterText) }, runs }, null, 2));
