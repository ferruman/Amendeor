import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function uuid(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function sceneGroups(text: string, limit = 700): string[] {
  const paragraphs = text.trim().split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const groups: string[] = [];
  let current: string[] = []; let count = 0;
  for (const paragraph of paragraphs) {
    const words = paragraph.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
    if (current.length && count + words > limit) { groups.push(current.join('\n\n')); current = []; count = 0; }
    current.push(paragraph); count += words;
  }
  if (current.length) groups.push(current.join('\n\n'));
  return groups;
}

async function writeWorkspace(id: string, language: string, chapters: Array<{ title: string; text: string }>, controlIndex: number): Promise<void> {
  const dir = path.join(root, 'eval', 'fixtures', id, 'original');
  await mkdir(path.join(dir, 'manuscript', 'chapters'), { recursive: true });
  await writeFile(path.join(dir, 'codicora.yaml'), `spec: codicora/v1\ntype: project\nproject:\n  id: ${id}\n  title: ${JSON.stringify(id)}\n  source_language: ${language}\nmanuscript:\n  path: manuscript\nedited:\n  path: edited\n`);
  let manifest = `schema_version: 1\nlanguage: ${language}\nchapters:\n`;
  for (const [index, chapter] of chapters.entries()) {
    const slug = `${String(index + 1).padStart(2, '0')}-${id === 'jekyll-en' ? 'jekyll' : 'kashtanka'}`;
    manifest += `  - slug: ${slug}\n    title: ${JSON.stringify(chapter.title)}\n    eval_control: ${index === controlIndex}\n`;
    const scenes = sceneGroups(chapter.text);
    const output = scenes.map((scene, sceneIndex) => `<!-- scene: ${uuid(`${id}:${slug}:${sceneIndex}`)} -->\n${scene}`).join('\n\n') + '\n';
    await writeFile(path.join(dir, 'manuscript', 'chapters', `${slug}.md`), output);
  }
  await writeFile(path.join(dir, 'manuscript', 'manuscript.yaml'), manifest);
  await writeFile(path.join(root, 'eval', 'fixtures', id, 'fixture.json'), `${JSON.stringify({ id, language, control_chapter: `${String(controlIndex + 1).padStart(2, '0')}-${id === 'jekyll-en' ? 'jekyll' : 'kashtanka'}`, version: '1.0.0' }, null, 2)}\n`);
}

const gutenberg = (await readFile(path.resolve(root, '../pg43.txt'), 'utf8')).replace(/\r\n?/g, '\n');
const marker = gutenberg.indexOf('*** START OF THE PROJECT GUTENBERG EBOOK');
if (marker < 0) throw new Error('Gutenberg start marker missing');
const bodyStart = gutenberg.indexOf('\n', marker) + 1;
const end = gutenberg.indexOf('*** END OF THE PROJECT GUTENBERG EBOOK', bodyStart);
if (end < 0) throw new Error('Gutenberg end marker missing');
const gutenbergBody = gutenberg.slice(bodyStart, end);
const titles = ['STORY OF THE DOOR', 'SEARCH FOR MR. HYDE', 'DR. JEKYLL WAS QUITE AT EASE', 'THE CAREW MURDER CASE', 'INCIDENT OF THE LETTER'];
const positions = titles.map((title) => {
  const match = new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm').exec(gutenbergBody);
  if (!match) throw new Error(`Gutenberg chapter missing: ${title}`);
  return match.index;
});
const english = titles.slice(0, 4).map((title, index) => ({ title, text: gutenbergBody.slice(positions[index]! + title.length, positions[index + 1]!).trim().split(/\n\s*\n/).map((paragraph) => paragraph.trim().replace(/\n/g, ' ')).join('\n\n') }));
await writeWorkspace('jekyll-en', 'en', english, 2);

const raw = await readFile(path.join(root, 'eval/sources/kashtanka.wiki.txt'), 'utf8');
const wikiStart = raw.indexOf('<div class="text">');
if (wikiStart < 0) throw new Error('Wikisource text marker missing');
const wikiEnd = raw.indexOf('=== Примечания ===', wikiStart);
const body = raw.slice(wikiStart, wikiEnd < 0 ? undefined : wikiEnd);
const headings = [...body.matchAll(/^===\s*(.*?)\s*===\s*$/gm)];
if (headings.length < 7) throw new Error('Wikisource chapter headings missing');
const russian = headings.slice(0, 7).map((heading, index) => {
  const start = heading.index! + heading[0].length;
  const end = headings[index + 1]?.index ?? body.length;
  const title = heading[1]!.replace(/<br\s*\/?\s*>/gi, ' ').replace(/\s+/g, ' ').trim();
  const text = body.slice(start, end).replace(/<ref>[\s\S]*?<\/ref>/g, '').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|\u00a0/g, ' ').replace(/''/g, '').trim().replace(/[ \t]+$/gm, '');
  return { title, text };
});
await writeWorkspace('kashtanka-ru', 'ru', russian, 2);
