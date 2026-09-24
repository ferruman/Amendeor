import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSource } from '../src/source/index.ts';
import { loadPack } from '../src/lang/pack.ts';
import { dialogueSpans } from '../src/text/dialogue.ts';

export type MutationType = 'typo' | 'doubled-word' | 'punctuation' | 'agreement' | 'redundancy' | 'qualifier' | 'dialogue-format' | 'terminology' | 'sentence-frame' | 'formulaic';
export interface Mutation { id: string; type: MutationType; pattern_id?: string; chapter: string; scene: string; span: { start: number; end: number }; original: string; mutated: string }
export interface PreserveSpan { chapter: string; scene: string; start: number; end: number; text: string; note: string }
interface Candidate { start: number; end: number; replacement: string }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const kinds: MutationType[] = ['typo', 'doubled-word', 'punctuation', 'agreement', 'redundancy', 'qualifier', 'dialogue-format', 'terminology', 'sentence-frame'];

function hashSeed(value: string): number { let n = 2166136261; for (const c of value) n = Math.imul(n ^ c.charCodeAt(0), 16777619); return n >>> 0; }
function candidates(text: string, lang: string, type: MutationType): Candidate[] {
  const out: Candidate[] = [];
  const add = (regex: RegExp, replace: (match: RegExpExecArray) => string) => {
    for (const match of text.matchAll(regex)) out.push({ start: match.index!, end: match.index! + match[0].length, replacement: replace(match) });
  };
  if (type === 'typo') add(lang === 'ru' ? /(?<![А-Яа-яЁё])[А-Яа-яЁё]{6,}(?![А-Яа-яЁё])/gu : /\b[A-Za-z]{6,}\b/g, (m) => `${m[0]!.slice(0, 2)}${m[0]![3]}${m[0]![2]}${m[0]!.slice(4)}`);
  if (type === 'doubled-word') add(lang === 'ru' ? /(?<![А-Яа-яЁё])[А-Яа-яЁё]{4,}(?![А-Яа-яЁё])/gu : /\b[A-Za-z]{4,}\b/g, (m) => `${m[0]} ${m[0]}`);
  if (type === 'punctuation') add(/,(?=\s+\p{L})/gu, () => '');
  if (type === 'agreement') {
    if (lang === 'ru') add(/(?<![А-Яа-яЁё])(?:была|стояла|сказала|думала|пошла|видела)(?![А-Яа-яЁё])/giu, (m) => ({ была: 'был', стояла: 'стоял', сказала: 'сказал', думала: 'думал', пошла: 'пошёл', видела: 'видел' })[m[0]!.toLowerCase() as 'была'] ?? 'был');
    else add(/\b(?:was|were|has|have|is|are)\b/g, (m) => ({ was: 'were', were: 'was', has: 'have', have: 'has', is: 'are', are: 'is' })[m[0] as 'was']);
  }
  if (type === 'redundancy') add(lang === 'ru' ? /(?<![А-Яа-яЁё])(?:сказал|сказала|был|была|стал)(?![А-Яа-яЁё])/giu : /\b(?:said|was|were|became|looked)\b/g, (m) => lang === 'ru' ? `${m[0]} снова снова` : `${m[0]} again again`);
  if (type === 'qualifier') add(lang === 'ru' ? /(?<![А-Яа-яЁё])(?:казалось|возможно|наверное)(?![А-Яа-яЁё])/giu : /\b(?:seemed|perhaps|possibly)\b/gi, (m) => lang === 'ru' ? `в некоторой степени ${m[0]}` : `somewhat ${m[0]}`);
  if (type === 'dialogue-format') add(lang === 'ru' ? /(?<=\n)\s*—(?=\s*\p{L})/gu : /[“”]/g, () => lang === 'ru' ? '-' : '"');
  if (type === 'terminology') add(lang === 'ru' ? /(?<![А-Яа-яЁё])Каштанка(?![А-Яа-яЁё])/g : /\bHyde\b/g, () => lang === 'ru' ? 'Каштаночка' : 'Hide');
  if (type === 'sentence-frame') add(lang === 'ru' ? /(?<![А-Яа-яЁё])(?:она|он|Каштанка)\s+\p{L}{4,}/giu : /\b(?:he|she|Mr\. Hyde|Utterson)\s+\p{L}{4,}/giu, (m) => `${m[0]}. ${m[0]}`);
  if (type === 'formulaic') add(lang === 'ru' ? /(?<=[.!?]\s|^)[А-ЯЁ][а-яё]{3,}\s+[а-яё]{3,}/gmu : /(?<=[.!?]\s|^)[A-Z][a-z]{3,}\s+[a-z]{3,}/gmu,
    (m) => lang === 'ru' ? `В современном мире ${m[0]}` : `At the end of the day, ${m[0]}`);
  return out.filter((item) => text.slice(item.start, item.end) !== item.replacement && !item.replacement.includes('\n\n'));
}

export async function generateMutations(work: string, seed = 'amendeor-v1', includeFormulaic = false): Promise<Mutation[]> {
  const fixtureDir = path.join(root, 'eval/fixtures', work);
  const fixture = JSON.parse(await readFile(path.join(fixtureDir, 'fixture.json'), 'utf8')) as { language: string; control_chapter: string };
  const preserve = JSON.parse(await readFile(path.join(fixtureDir, 'preserve.json'), 'utf8')) as { spans: PreserveSpan[] };
  const originalDir = path.join(fixtureDir, 'original');
  const mutatedDir = path.join(fixtureDir, includeFormulaic ? 'mutated-formulaic' : 'mutated');
  await rm(mutatedDir, { recursive: true, force: true });
  await cp(originalDir, mutatedDir, { recursive: true, force: true });
  const source = await openSource(originalDir);
  const pack = (await loadPack(fixture.language)).pack;
  const picks = new Map<string, Array<{ type: MutationType; candidate: Candidate; chapter: string; scene: string }>>();
  for (const type of includeFormulaic ? [...kinds, 'formulaic' as const] : kinds) {
    const eligible: Array<{ type: MutationType; candidate: Candidate; chapter: string; scene: string }> = [];
    for (const chapter of source.book.chapters) {
      if (chapter.slug === fixture.control_chapter) continue;
      for (const scene of chapter.scenes) {
        const dialogue = type === 'formulaic' ? dialogueSpans(scene.text, pack) : [];
        for (const candidate of candidates(scene.text, fixture.language, type)) {
          const blocked = preserve.spans.some((span) => span.chapter === chapter.slug && span.scene === scene.id && candidate.start < span.end && candidate.end > span.start);
          const insideDialogue = dialogue.some((span) => candidate.start < span.end && candidate.end > span.start);
          const key = `${chapter.slug}/${scene.id}`;
          const overlaps = (picks.get(key) ?? []).some((pick) => candidate.start < pick.candidate.end && candidate.end > pick.candidate.start);
          if (!blocked && !insideDialogue && !overlaps) eligible.push({ type, candidate, chapter: chapter.slug, scene: scene.id });
        }
      }
    }
    if (!eligible.length) throw new Error(`no eligible ${type} mutation for ${work}`);
    const selected = eligible[hashSeed(`${seed}:${work}:${type}`) % eligible.length]!;
    const key = `${selected.chapter}/${selected.scene}`;
    picks.set(key, [...(picks.get(key) ?? []), selected]);
  }
  const mutations: Mutation[] = [];
  for (const chapter of source.book.chapters) {
    let updated = chapter.text;
    const chapterEdits: Array<{ start: number; end: number; replacement: string }> = [];
    for (const scene of chapter.scenes) {
      const edits = (picks.get(`${chapter.slug}/${scene.id}`) ?? []).sort((a, b) => a.candidate.start - b.candidate.start);
      let shift = 0;
      for (const [index, edit] of edits.entries()) {
        const { start, end, replacement } = edit.candidate;
        const original = scene.text.slice(start, end);
        mutations.push({ id: `${work}:${edit.type}:${index}:${chapter.slug}:${scene.id}`, type: edit.type, ...(edit.type === 'formulaic' ? { pattern_id: 'formulaic.filler-frame' } : {}), chapter: chapter.slug, scene: scene.id, span: { start: start + shift, end: start + shift + replacement.length }, original, mutated: replacement });
        shift += replacement.length - (end - start);
      }
      for (const edit of edits) chapterEdits.push({ start: scene.start + edit.candidate.start, end: scene.start + edit.candidate.end, replacement: edit.candidate.replacement });
    }
    for (const edit of chapterEdits.sort((a, b) => b.start - a.start)) updated = `${updated.slice(0, edit.start)}${edit.replacement}${updated.slice(edit.end)}`;
    await writeFile(path.join(mutatedDir, 'manuscript/chapters', path.basename(chapter.file)), updated);
  }
  await writeFile(path.join(fixtureDir, includeFormulaic ? 'formulaic-mutations.json' : 'mutations.json'), `${JSON.stringify({ seed, mutations }, null, 2)}\n`);
  return mutations;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const work = process.argv[2]; if (!work) throw new Error('usage: node eval/mutate.ts <work> [seed] [--formulaic]');
  console.log(JSON.stringify({ work, count: (await generateMutations(work, process.argv[3], process.argv.includes('--formulaic'))).length }));
}
