// Отложенная чистая фикстура (2026-10-10): авторская проза без внесённых ошибок, чтобы измерить, оставляет ли Amendeor её как есть.
// Ни один текст не входит в оценочные фикстуры kashtanka-ru / jekyll-en; модели фикстуру не создавали.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
function uuid(seed: string): string {
  const hex = sha(seed);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
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
async function writeWorkspace(id: string, short: string, language: string, chapters: Array<{ title: string; text: string }>): Promise<Array<{ title: string; words: number; sha256: string }>> {
  const base = path.join(root, 'eval', 'fixtures', id);
  await rm(base, { recursive: true, force: true });
  const dir = path.join(base, 'original');
  await mkdir(path.join(dir, 'manuscript', 'chapters'), { recursive: true });
  await writeFile(path.join(dir, 'codicora.yaml'), `spec: codicora/v1\ntype: project\nproject:\n  id: ${id}\n  title: ${JSON.stringify(id)}\n  source_language: ${language}\nmanuscript:\n  path: manuscript\nedited:\n  path: edited\n`);
  let manifest = `schema_version: 1\nlanguage: ${language}\nchapters:\n`;
  const stats = [];
  for (const [index, chapter] of chapters.entries()) {
    const slug = `${String(index + 1).padStart(2, '0')}-${short}`;
    manifest += `  - slug: ${slug}\n    title: ${JSON.stringify(chapter.title)}\n    eval_control: true\n`;
    const output = sceneGroups(chapter.text).map((scene, sceneIndex) => `<!-- scene: ${uuid(`${id}:${slug}:${sceneIndex}`)} -->\n${scene}`).join('\n\n') + '\n';
    await writeFile(path.join(dir, 'manuscript', 'chapters', `${slug}.md`), output);
    stats.push({ title: chapter.title, words: chapter.text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0, sha256: sha(chapter.text) });
  }
  await writeFile(path.join(dir, 'manuscript', 'manuscript.yaml'), manifest);
  // Вся фикстура — контроль: мутаций нет, любая принятая правка — изменение авторского текста.
  await writeFile(path.join(base, 'fixture.json'), `${JSON.stringify({ id, language, control_chapter: `01-${short}`, clean: true, version: '1.0.0' }, null, 2)}\n`);
  await writeFile(path.join(base, 'mutations-original.json'), `${JSON.stringify({ seed: null, note: 'clean fixture: no injected errors', mutations: [] }, null, 2)}\n`);
  await writeFile(path.join(base, 'preserve.json'), `${JSON.stringify({ spans: [] }, null, 2)}\n`);
  return stats;
}

// Русский: три рассказа Чехова, Wikisource (PD-old-70), та же очистка, что для «Каштанки».
const stories = [['smert-chinovnika', 'Смерть чиновника'], ['zloumyshlennik', 'Злоумышленник'], ['vanka-1886', 'Ванька']] as const;
const russian = [];
const sources: Record<string, string> = {};
for (const [file, title] of stories) {
  const raw = await readFile(path.join(root, 'eval/sources', `${file}.wiki.txt`), 'utf8');
  sources[`eval/sources/${file}.wiki.txt`] = sha(raw);
  const header = raw.indexOf('\n}}');
  if (header < 0) throw new Error(`Wikisource header missing in ${file}`);
  const ends = [raw.search(/\{\{[Пп]римечания/), raw.indexOf('[[Категория:')].filter((index) => index > header);
  const text = raw.slice(header + 3, Math.min(...ends)).replace(/<ref[^>]*\/>/g, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;| /g, ' ').replace(/''/g, '').replace(/\{\{[^}]*\}\}/g, '').replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').trim().replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n');
  if (/[{}<>[\]]/.test(text)) throw new Error(`markup left in ${file}`);
  russian.push({ title, text });
}
const ru = await writeWorkspace('clean-ru', 'chekhov', 'ru', russian);

// Английский: две главы Jekyll and Hyde, которых нет в фикстуре jekyll-en (она берёт первые четыре).
const gutenberg = (await readFile(path.resolve(root, '../pg43.txt'), 'utf8')).replace(/\r\n?/g, '\n');
sources['../pg43.txt'] = sha(gutenberg);
const body = gutenberg.slice(gutenberg.indexOf('\n', gutenberg.indexOf('*** START OF THE PROJECT GUTENBERG EBOOK')) + 1, gutenberg.indexOf('*** END OF THE PROJECT GUTENBERG EBOOK'));
const titles = ['INCIDENT OF DR. LANYON', 'INCIDENT AT THE WINDOW', 'THE LAST NIGHT'];
const at = titles.map((title) => { const match = new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm').exec(body); if (!match) throw new Error(`chapter missing: ${title}`); return match.index; });
const english = titles.slice(0, 2).map((title, index) => ({ title, text: body.slice(at[index]! + title.length, at[index + 1]!).trim().split(/\n\s*\n/).map((paragraph) => paragraph.trim().replace(/\n/g, ' ')).join('\n\n') }));
const en = await writeWorkspace('clean-en', 'jekyll', 'en', english);
console.log(JSON.stringify({ sources, ru, en }, null, 2));
