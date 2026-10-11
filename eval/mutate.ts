import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSource, type OpenedSource } from '../src/source/index.ts';
import { loadPack, type LanguagePack } from '../src/lang/pack.ts';
import { dialogueSpans } from '../src/text/dialogue.ts';
import { splitScenes, type Book } from '../src/book.ts';
import { configSchema } from '../src/config.ts';
import { enabledRules, ruleContext } from '../src/rules/index.ts';

export type MutationType = 'typo' | 'doubled-word' | 'punctuation' | 'agreement' | 'redundancy' | 'qualifier' | 'dialogue-format' | 'terminology' | 'sentence-frame' | 'formulaic';
export type EditMode = 'copy' | 'proofread' | 'mechanical';
// Кто вправе исправить мутацию в режиме прогона: модель, детерминированное правило, только proofread — или никто по политике.
export type PolicyLabel = 'model-fixable' | 'rule-fixable' | 'proofread-only' | 'blocked-by-policy';
export interface Mutation {
  id: string; type: MutationType; pattern_id?: string; chapter: string; scene: string; span: { start: number; end: number }; original: string; mutated: string;
  // Только генератор v2: политика для режима mode и допустимые альтернативы восстановлению original.
  mode?: EditMode; policy?: PolicyLabel[]; alternatives?: string[]; in_dialogue?: boolean;
}
export interface PreserveSpan { chapter: string; scene: string; start: number; end: number; text: string; note: string }
interface Candidate { start: number; end: number; replacement: string }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const kinds: MutationType[] = ['typo', 'doubled-word', 'punctuation', 'agreement', 'redundancy', 'qualifier', 'dialogue-format', 'terminology', 'sentence-frame'];

function hashSeed(value: string): number { let n = 2166136261; for (const c of value) n = Math.imul(n ^ c.charCodeAt(0), 16777619); return n >>> 0; }
function candidates(text: string, lang: string, type: MutationType, generator: 1 | 2): Candidate[] {
  const out: Candidate[] = [];
  const add = (regex: RegExp, replace: (match: RegExpExecArray) => string) => {
    for (const match of text.matchAll(regex)) out.push({ start: match.index!, end: match.index! + match[0].length, replacement: replace(match) });
  };
  // v2: опечатка только в нарицательном слове — опечатку в имени модели исправлять запрещено (proper-name-change).
  if (type === 'typo') add(lang === 'ru' ? (generator === 1 ? /(?<![А-Яа-яЁё])[А-Яа-яЁё]{6,}(?![А-Яа-яЁё])/gu : /(?<![А-Яа-яЁё])[а-яё]{6,}(?![А-Яа-яЁё])/gu) : (generator === 1 ? /\b[A-Za-z]{6,}\b/g : /\b[a-z]{6,}\b/g), (m) => `${m[0]!.slice(0, 2)}${m[0]![3]}${m[0]![2]}${m[0]!.slice(4)}`);
  if (type === 'doubled-word') add(lang === 'ru' ? /(?<![А-Яа-яЁё])[А-Яа-яЁё]{4,}(?![А-Яа-яЁё])/gu : /\b[A-Za-z]{4,}\b/g, (m) => `${m[0]} ${m[0]}`);
  if (type === 'punctuation') add(/,(?=\s+\p{L})/gu, () => '');
  if (type === 'agreement') {
    if (lang === 'ru') add(/(?<![А-Яа-яЁё])(?:была|стояла|сказала|думала|пошла|видела)(?![А-Яа-яЁё])/giu, (m) => ({ была: 'был', стояла: 'стоял', сказала: 'сказал', думала: 'думал', пошла: 'пошёл', видела: 'видел' })[m[0]!.toLowerCase() as 'была'] ?? 'был');
    else add(/\b(?:was|were|has|have|is|are)\b/g, (m) => ({ was: 'were', were: 'was', has: 'have', have: 'has', is: 'are', are: 'is' })[m[0] as 'was']);
  }
  if (type === 'redundancy') add(lang === 'ru' ? /(?<![А-Яа-яЁё])(?:сказал|сказала|был|была|стал)(?![А-Яа-яЁё])/giu : /\b(?:said|was|were|became|looked)\b/g, (m) => lang === 'ru' ? `${m[0]} снова снова` : `${m[0]} again again`);
  if (type === 'qualifier') add(lang === 'ru' ? /(?<![А-Яа-яЁё])(?:казалось|возможно|наверное)(?![А-Яа-яЁё])/giu : /\b(?:seemed|perhaps|possibly)\b/gi, (m) => lang === 'ru' ? `в некоторой степени ${m[0]}` : `somewhat ${m[0]}`);
  // AUD-F5: в v1 \s* съедал перевод строки и мутация удаляла границу абзаца, которую правка внутри абзаца не может вернуть.
  if (type === 'dialogue-format') add(lang === 'ru' ? (generator === 1 ? /(?<=\n)\s*—(?=\s*\p{L})/gu : /(?<=\n)[ \t]*—(?=[ \t]*\p{L})/gu) : /[“”]/g, () => lang === 'ru' ? '-' : '"');
  if (type === 'terminology') add(lang === 'ru' ? /(?<![А-Яа-яЁё])Каштанка(?![А-Яа-яЁё])/g : /\bHyde\b/g, () => lang === 'ru' ? 'Каштаночка' : 'Hide');
  if (type === 'sentence-frame') add(lang === 'ru' ? /(?<![А-Яа-яЁё])(?:она|он|Каштанка)\s+\p{L}{4,}/giu : /\b(?:he|she|Mr\. Hyde|Utterson)\s+\p{L}{4,}/giu, (m) => `${m[0]}. ${m[0]}`);
  if (type === 'formulaic') add(lang === 'ru' ? /(?<=[.!?]\s|^)[А-ЯЁ][а-яё]{3,}\s+[а-яё]{3,}/gmu : /(?<=[.!?]\s|^)[A-Z][a-z]{3,}\s+[a-z]{3,}/gmu,
    (m) => lang === 'ru' ? `В современном мире ${m[0]}` : `At the end of the day, ${m[0]}`);
  return out.filter((item) => text.slice(item.start, item.end) !== item.replacement && !item.replacement.includes('\n\n')
    && (generator === 1 || !/\n/.test(text.slice(item.start, item.end)) && !item.replacement.includes('\n')));
}

// Что разрешено модели в режиме mode (copy-edit.ts, guard/traps.ts): правка слов реплики запрещена, запятые — только proofread,
// пунктуация без букв — только правилами, имена — только по словарю автора.
function modelPolicy(type: MutationType, mode: EditMode, dialogue: boolean): PolicyLabel[] {
  if (type === 'terminology' || type === 'dialogue-format') return [];
  if (type === 'punctuation') return [mode === 'proofread' ? 'model-fixable' : 'proofread-only'];
  if (dialogue) return [];
  const allowed: Record<EditMode, MutationType[]> = {
    copy: ['typo', 'doubled-word', 'agreement', 'redundancy', 'qualifier', 'sentence-frame', 'formulaic'],
    proofread: ['typo', 'doubled-word', 'agreement'],
    mechanical: ['typo', 'agreement']
  };
  return allowed[mode].includes(type) ? ['model-fixable'] : [];
}

function alternativesFor(type: MutationType, original: string, lang: string): string[] {
  // Минимальная правка «сказал снова снова» → «сказал снова»: редактор не может знать, что вставлено и первое «снова».
  if (type === 'redundancy') return [`${original} ${lang === 'ru' ? 'снова' : 'again'}`];
  // Только v1 (AUD-F5): мутация заодно съела перевод строки; внесённая ошибка — дефис, и его исправление без абзаца — допустимая альтернатива.
  if (type === 'dialogue-format' && /^\s/u.test(original)) return [original.replace(/^\s+/u, '')];
  return [];
}

export interface Plan { mutations: Mutation[]; chapters: Map<string, string> }
export function planMutations(source: OpenedSource, fixture: { language: string; control_chapter: string }, preserve: { spans: PreserveSpan[] }, pack: LanguagePack, work: string, seed: string, includeFormulaic: boolean, options: { generator?: 1 | 2; mode?: EditMode; types?: MutationType[] } = {}): Plan {
  const generator = options.generator ?? 1;
  const picks = new Map<string, Array<{ type: MutationType; candidate: Candidate; chapter: string; scene: string; dialogue: boolean }>>();
  // types — подмножество видов мутаций для текста, где часть видов неприменима (нет «Hyde» / «Каштанки»).
  for (const type of options.types ?? (includeFormulaic ? [...kinds, 'formulaic' as const] : kinds)) {
    const eligible: Array<{ type: MutationType; candidate: Candidate; chapter: string; scene: string; dialogue: boolean }> = [];
    for (const chapter of source.book.chapters) {
      if (chapter.slug === fixture.control_chapter) continue;
      for (const scene of chapter.scenes) {
        const spans = dialogueSpans(scene.text, pack);
        const abbreviation = new RegExp(`(?:^|\\s)(?:${pack.abbreviations.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s*$`, 'iu');
        for (const candidate of candidates(scene.text, fixture.language, type, generator)) {
          const blocked = preserve.spans.some((span) => span.chapter === chapter.slug && span.scene === scene.id && candidate.start < span.end && candidate.end > span.start);
          const dialogue = spans.some((span) => candidate.start < span.end && candidate.end > span.start);
          // v1: реплики исключались только для formulaic. v2: везде, кроме мутаций, которые по смыслу проверяют реплику
          // (dialogue-format) или правило-дубль внутри неё (doubled-word); после сокращения («Mr.») не начинается предложение.
          const insideDialogue = dialogue && (generator === 1 ? type === 'formulaic' : !['dialogue-format', 'doubled-word'].includes(type));
          const afterAbbreviation = generator === 2 && type === 'formulaic' && abbreviation.test(scene.text.slice(Math.max(0, candidate.start - 12), candidate.start));
          const key = `${chapter.slug}/${scene.id}`;
          const overlaps = (picks.get(key) ?? []).some((pick) => candidate.start < pick.candidate.end && candidate.end > pick.candidate.start);
          if (!blocked && !insideDialogue && !afterAbbreviation && !overlaps) eligible.push({ type, candidate, chapter: chapter.slug, scene: scene.id, dialogue });
        }
      }
    }
    if (!eligible.length) throw new Error(`no eligible ${type} mutation for ${work}`);
    const selected = eligible[hashSeed(`${seed}:${work}:${type}`) % eligible.length]!;
    const key = `${selected.chapter}/${selected.scene}`;
    picks.set(key, [...(picks.get(key) ?? []), selected]);
  }
  const mutations: Mutation[] = []; const chapters = new Map<string, string>();
  for (const chapter of source.book.chapters) {
    let updated = chapter.text;
    const chapterEdits: Array<{ start: number; end: number; replacement: string }> = [];
    for (const scene of chapter.scenes) {
      const edits = (picks.get(`${chapter.slug}/${scene.id}`) ?? []).sort((a, b) => a.candidate.start - b.candidate.start);
      let shift = 0;
      for (const [index, edit] of edits.entries()) {
        const { start, end, replacement } = edit.candidate;
        const original = scene.text.slice(start, end);
        mutations.push({ id: `${work}:${edit.type}:${index}:${chapter.slug}:${scene.id}`, type: edit.type, ...(edit.type === 'formulaic' ? { pattern_id: 'formulaic.filler-frame' } : {}), chapter: chapter.slug, scene: scene.id, span: { start: start + shift, end: start + shift + replacement.length }, original, mutated: replacement,
          ...(generator === 2 ? { mode: options.mode ?? 'copy', in_dialogue: edit.dialogue, policy: modelPolicy(edit.type, options.mode ?? 'copy', edit.dialogue), alternatives: alternativesFor(edit.type, original, fixture.language) } : {}) });
        shift += replacement.length - (end - start);
      }
      for (const edit of edits) chapterEdits.push({ start: scene.start + edit.candidate.start, end: scene.start + edit.candidate.end, replacement: edit.candidate.replacement });
    }
    for (const edit of chapterEdits.sort((a, b) => b.start - a.start)) updated = `${updated.slice(0, edit.start)}${edit.replacement}${updated.slice(edit.end)}`;
    chapters.set(chapter.file, updated);
  }
  if (generator === 2) {
    const mutated: Book = { lang: source.book.lang, chapters: source.book.chapters.map((chapter) => { const text = chapters.get(chapter.file)!; return { ...chapter, text, scenes: splitScenes(text) }; }) };
    labelRuleFixes(mutated, mutations, pack);
  }
  return { mutations, chapters };
}

// Политика для мутаций без неё (исторические фикстуры v1): те же правила, что у генератора v2, на изменённом тексте.
export function withPolicy(mutated: Book, mutations: Mutation[], pack: LanguagePack, mode: EditMode = 'copy'): Mutation[] {
  const result = mutations.map((mutation) => {
    if (mutation.policy) return mutation;
    const scene = mutated.chapters.find((chapter) => chapter.slug === mutation.chapter)!.scenes.find((item) => item.id === mutation.scene)!;
    const dialogue = dialogueSpans(scene.text, pack).some((span) => mutation.span.start < span.end && mutation.span.end > span.start);
    return { ...mutation, mode, in_dialogue: dialogue, policy: modelPolicy(mutation.type, mode, dialogue), alternatives: alternativesFor(mutation.type, mutation.original, mutated.lang) };
  });
  labelRuleFixes(mutated, result.filter((mutation) => !mutations.find((item) => item.id === mutation.id)?.policy), pack);
  return result;
}

// rule-fixable ставится по факту: включённые по умолчанию правила на изменённом тексте дают точное восстановление или допустимую альтернативу.
function labelRuleFixes(mutated: Book, mutations: Mutation[], pack: LanguagePack): void {
  const config = configSchema.parse({});
  for (const mutation of mutations) {
    const scene = mutated.chapters.find((chapter) => chapter.slug === mutation.chapter)!.scenes.find((item) => item.id === mutation.scene)!;
    const context = ruleContext(mutated, config, pack, scene);
    const fixes = enabledRules(config, mutated.lang).flatMap((rule) => rule.detect(scene, context)).some((draft) => {
      const start = draft.start, end = draft.start + draft.target.length;
      if (start > mutation.span.end || end < mutation.span.start) return false;
      const from = Math.min(start, mutation.span.start), to = Math.max(end, mutation.span.end);
      const got = scene.text.slice(from, start) + draft.replacement + scene.text.slice(end, to);
      return [mutation.original, ...(mutation.alternatives ?? [])].some((text) => got === scene.text.slice(from, mutation.span.start) + text + scene.text.slice(mutation.span.end, to));
    });
    if (fixes) mutation.policy = [...mutation.policy!, 'rule-fixable'];
    if (!mutation.policy!.length) mutation.policy = ['blocked-by-policy'];
  }
}

// v1 (по умолчанию) пишет прежние mutated/ и mutations.json — исторические фикстуры воспроизводятся байт в байт.
// v2 пишет в отдельные mutated-<name>/ и mutations-<name>.json и не трогает исторические файлы.
export async function generateMutations(work: string, seed = 'amendeor-v1', includeFormulaic = false, options: { generator?: 1 | 2; name?: string; mode?: EditMode } = {}): Promise<Mutation[]> {
  const fixtureDir = path.join(root, 'eval/fixtures', work);
  const fixture = JSON.parse(await readFile(path.join(fixtureDir, 'fixture.json'), 'utf8')) as { language: string; control_chapter: string };
  const preserve = JSON.parse(await readFile(path.join(fixtureDir, 'preserve.json'), 'utf8')) as { spans: PreserveSpan[] };
  if ((options.generator ?? 1) === 2 && !options.name) throw new Error('generator 2 needs a fixture name so historical files stay intact');
  const mutatedDir = path.join(fixtureDir, options.name ? `mutated-${options.name}` : includeFormulaic ? 'mutated-formulaic' : 'mutated');
  const mutationsFile = path.join(fixtureDir, options.name ? `mutations-${options.name}.json` : includeFormulaic ? 'formulaic-mutations.json' : 'mutations.json');
  const originalDir = path.join(fixtureDir, 'original');
  const source = await openSource(originalDir);
  const plan = planMutations(source, fixture, preserve, (await loadPack(fixture.language)).pack, work, seed, includeFormulaic, options);
  await rm(mutatedDir, { recursive: true, force: true });
  await cp(originalDir, mutatedDir, { recursive: true, force: true });
  for (const chapter of source.book.chapters) await writeFile(path.join(mutatedDir, 'manuscript/chapters', path.basename(chapter.file)), plan.chapters.get(chapter.file)!);
  await writeFile(mutationsFile, `${JSON.stringify(options.generator === 2 ? { seed, generator: 2, mode: options.mode ?? 'copy', mutations: plan.mutations } : { seed, mutations: plan.mutations }, null, 2)}\n`);
  return plan.mutations;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const work = process.argv[2]; if (!work) throw new Error('usage: node eval/mutate.ts <work> [seed] [--formulaic] [--generator 2 --name <fixture> [--mode copy|proofread|mechanical]]');
  const flag = (name: string) => { const index = process.argv.indexOf(name); return index > 0 ? process.argv[index + 1] : undefined; };
  const seed = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : undefined;
  console.log(JSON.stringify({ work, count: (await generateMutations(work, seed, process.argv.includes('--formulaic'), { generator: flag('--generator') === '2' ? 2 : 1, name: flag('--name'), mode: flag('--mode') as EditMode | undefined })).length }));
}
