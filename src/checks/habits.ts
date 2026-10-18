// Прореживание привычек книги: статистика → один запрос → пачка правок. Проход по всей книге (book-pass) называет
// привычку и её число, но правки не даёт; править каждую главу по отдельности — дорого и без взгляда на всю книгу
// (на The Shepherd's Silence ~250 употреблений восьми привычек). Здесь все вхождения собираются детерминированно,
// модель за один запрос решает про каждое — оставить или заменить, с правилами на всю книгу, — а детерминированные
// проверки отсекают замену, которая вносит другую привычку, повторяет уже сделанную замену, написана на чужом
// языке или вычищает привычку целиком. Результат — находки style.book.thin с заменой; edit проверяет смысл
// (три единогласных прохода) и делает из них правки только на решение автора.
import { z } from 'zod';
import type { Book } from '../book.ts';
import type { LoadedConfig } from '../config.ts';
import type { LanguagePack } from '../lang/pack.ts';
import { Cache } from '../cache.ts';
import { Gateway } from '../provider/gateway.ts';
import { SpendRefused } from '../provider/meter.ts';
import { parseModelJson } from '../provider/json.ts';
import { sha256 } from '../hash.ts';
import { sentences } from '../text/segment.ts';
import { dialogueSpans, inDialogue } from '../text/dialogue.ts';
import { languageProfile, wrongLanguage } from '../lang/match.ts';
import type { GuideFinding } from './guide.ts';

const VERSION = 'habits-1';
// Сколько вхождений одной привычки отдаём модели и сколько — за один запрос.
const MAX_USES_PER_HABIT = 120, MAX_USES_PER_REQUEST = 220;
// «Проредить, не вычистить»: заменяется не больше двух третей вхождений привычки.
const MAX_REPLACED_SHARE = 2 / 3;

export interface Habit { id: string; summary: string; patterns: string[] }
export interface Use { id: string; habit: string; chapter: string; scene: string; start: number; end: number; sentence: string; dialogue: boolean }
export interface ThinFinding extends GuideFinding { kind: 'contextual'; confidence: number; habit: string }
export interface HabitsResult {
  status: 'ok' | 'partial' | 'refused';
  habits: number; uses: number; requests: number; cached: number;
  failures: Array<{ chapter: string; scene: string; reason: string }>;
  discarded: Array<{ chapter: string; scene: string; reason: string }>;
  ledger: Gateway['ledger'];
  findings: ThinFinding[];
}

// Фразы привычки: явные patterns прохода по книге, иначе — то, что описание привычки берёт в кавычки.
export function habitPatterns(summary: string, suggestion: string | undefined, patterns: unknown): string[] {
  const listed = Array.isArray(patterns) ? patterns.filter((p): p is string => typeof p === 'string') : [];
  const quoted = listed.length ? [] : [...`${summary} ${suggestion ?? ''}`.matchAll(/[“"«]([^”"»]{3,40})[”"»]/gu)].map((m) => m[1]!);
  return [...new Set([...listed, ...quoted].map((p) => p.replace(/(?:\.\.\.|…)/gu, ' ').replace(/[\s,.;:!?]+$/u, '').replace(/^[\s,.;:]+/u, '').trim().toLowerCase()).filter((p) => (p.match(/\p{L}/gu)?.length ?? 0) >= 3))];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const patternRe = (p: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(p).replace(/\s+/gu, '\\s+')}(?![\\p{L}\\p{N}])`, 'giu');
const occurrences = (text: string, p: string) => text.match(patternRe(p))?.length ?? 0;

export function collectUses(book: Book, habits: Habit[], pack: LanguagePack): Use[] {
  const uses: Use[] = [];
  for (const habit of habits) {
    const seen = new Set<string>();
    let n = 0;
    for (const chapter of book.chapters) for (const scene of chapter.scenes) {
      const dialogue = dialogueSpans(scene.text, pack);
      for (const span of sentences(scene.text, pack)) {
        if (n >= MAX_USES_PER_HABIT) break;
        const text = span.text.trimEnd();
        if (text.includes('\n') || !habit.patterns.some((p) => occurrences(text, p))) continue;
        const start = span.start + (span.text.length - span.text.trimStart().length);
        const sentence = text.trim();
        if (seen.has(`${chapter.slug}/${scene.id}/${start}`)) continue;
        seen.add(`${chapter.slug}/${scene.id}/${start}`);
        // В прямой речи — само вхождение привычки, а не всё предложение: «“…,” he said» — реплика персонажа.
        const hits = habit.patterns.flatMap((p) => [...sentence.matchAll(patternRe(p))].map((m) => start + m.index!));
        const spoken = hits.some((at) => inDialogue(dialogue, at, at + 1));
        uses.push({ id: `${habit.id.slice(-6)}-${++n}`, habit: habit.id, chapter: chapter.slug, scene: scene.id, start, end: start + sentence.length, sentence, dialogue: spoken });
      }
    }
  }
  return uses;
}

export const HABITS_SYSTEM = `You are the line editor of a novel, thinning its verbal habits. You are given each habit the copy edit found, with every sentence in the book where it occurs. For each occurrence decide: keep it, or replace that one sentence.

Book-wide rules:
- Thin, do not eliminate. Keep the occurrences that work: a motif the book builds on, a character's own way of speaking, rhythm at a turn of the scene, the first and the strongest uses. Frequency alone does not justify an edit. Preserve repetitions that function as motifs.
- In dialogue, change a line only when the habit is the author's, not the character's.
- Keep the meaning, the facts and the point of view of the sentence exactly. Change as little as the fix needs.
- Never use the same replacement wording twice, and never introduce another habit from this list (do not trade one tic for another).
- Write in the language of the manuscript, in the author's register.

For a replacement give the whole sentence as it should read, identical to the original except for the change.

Reply with JSON only: { "decisions": [{ "id": "<use id>", "action": "keep|replace", "replacement": "<the whole corrected sentence, replace only>", "reason": "one short sentence" }] }. Decide every id.`;

const decisionSchema = z.object({ id: z.string(), action: z.enum(['keep', 'replace']), replacement: z.string().optional(), reason: z.string().default('') });
const answerSchema = z.object({ decisions: z.array(z.unknown()).default([]) });

const languageName = (code: string) => { try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code; } catch { return code; } };

// Чем замена заменила привычку: слова, которых не было в исходной фразе. Тот же набор во второй замене — повтор
// одной находки («set … straight» вместо каждого «squared»), а это ровно та новая привычка, которой не должно быть.
function inserted(original: string, replacement: string): string {
  const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}'’]+/gu) ?? [];
  const before = new Set(words(original));
  return [...new Set(words(replacement).filter((w) => !before.has(w)))].sort().join(' ');
}

export function judgeDecisions(output: string, uses: Use[], habits: Habit[], book: Book, pack: LanguagePack, already: Set<string> = new Set()): { findings: ThinFinding[]; discarded: string[] } {
  const byId = new Map(uses.map((u) => [u.id, u]));
  const habitById = new Map(habits.map((h) => [h.id, h]));
  const allPatterns = habits.flatMap((h) => h.patterns);
  const language = languageProfile(book.chapters.map((c) => c.text).join('\n'), pack.stopwords);
  const findings: ThinFinding[] = [], discarded: string[] = [];
  const replaced = new Map<string, number>();
  for (const raw of answerSchema.parse(parseModelJson(output)).decisions) {
    const d = decisionSchema.safeParse(raw);
    if (!d.success) { discarded.push('decision breaks the schema'); continue; }
    const use = byId.get(d.data.id);
    if (!use) { discarded.push(`unknown use id ${d.data.id}`); continue; }
    if (d.data.action === 'keep') continue;
    const replacement = d.data.replacement?.trim() ?? '';
    const reject = (reason: string) => discarded.push(`${use.id}: ${reason}`);
    if (!replacement || replacement === use.sentence) { reject('no change'); continue; }
    if (replacement.includes('\n')) { reject('replacement spans paragraphs'); continue; }
    if (allPatterns.some((p) => occurrences(replacement, p) > occurrences(use.sentence, p))) { reject('replacement introduces a known habit'); continue; }
    const added = inserted(use.sentence, replacement);
    if (added && already.has(added)) { reject(`replacement wording reused: "${added.slice(0, 40)}"`); continue; }
    if (wrongLanguage([replacement], language)) { reject("replacement is not in the manuscript's language"); continue; }
    const habit = habitById.get(use.habit)!;
    const total = uses.filter((u) => u.habit === use.habit).length;
    const count = (replaced.get(use.habit) ?? 0) + 1;
    if (count > Math.floor(total * MAX_REPLACED_SHARE)) { reject('habit would be thinned below a third of its uses'); continue; }
    replaced.set(use.habit, count);
    if (added) already.add(added);
    findings.push({
      id: sha256(`${use.chapter}\n${use.scene}\n${use.start}\nbook.thin\n${use.sentence}`), guide: 'book', kind: 'contextual', principle: 'book.thin', source_pages: '',
      chapter: use.chapter, scene: use.scene, start: use.start, end: use.end, quote: use.sentence,
      reason: `${habit.summary.slice(0, 160)} — ${d.data.reason}`.trim(), provenance: 'habit thinning', severity: 'low', confidence: 0.7,
      replacement, habit: use.habit,
    });
  }
  return { findings, discarded };
}

// Запросы: все вхождения целиком, а если их больше предела — пачками по привычкам (привычка не делится).
function batches(habits: Habit[], uses: Use[]): Habit[][] {
  const out: Habit[][] = [];
  let current: Habit[] = [], size = 0;
  for (const h of habits) {
    const n = uses.filter((u) => u.habit === h.id).length;
    if (current.length && size + n > MAX_USES_PER_REQUEST) { out.push(current); current = []; size = 0; }
    current.push(h); size += n;
  }
  if (current.length) out.push(current);
  return out;
}

export async function thinHabits(book: Book, pack: LanguagePack, loaded: LoadedConfig, stateDir: string, habits: Habit[], noCache = false, transports: ConstructorParameters<typeof Gateway>[3] = {}): Promise<HabitsResult> {
  const profile = loaded.config.profiles.book ?? loaded.config.profiles.edit;
  if (!profile) throw new Error('habit thinning requires profiles.book (or profiles.edit)');
  const role = loaded.config.profiles.book ? 'book' : 'edit';
  const provider = loaded.config.providers[profile.provider];
  if (!provider) throw new Error(`provider ${profile.provider} missing`);
  const gateway = new Gateway(loaded.config, pack, process.env, transports);
  const cache = new Cache(stateDir, noCache);
  const uses = collectUses(book, habits, pack);
  const system = `${HABITS_SYSTEM}\n\nThe manuscript is in ${languageName(book.lang)}.`;
  const failures: HabitsResult['failures'] = [], discarded: HabitsResult['discarded'] = [], findings: ThinFinding[] = [];
  const reused = new Set<string>();
  let cached = 0, requests = 0, refused = false;
  for (const group of batches(habits.filter((h) => uses.some((u) => u.habit === h.id)), uses)) {
    if (refused) break;
    const mine = uses.filter((u) => group.some((h) => h.id === u.habit));
    const user = group.map((h) => `## Habit ${h.id}: ${h.summary}\nPatterns: ${h.patterns.join(' | ')}\n\n${mine.filter((u) => u.habit === h.id).map((u) => `[${u.id}] (${u.chapter}${u.dialogue ? ', dialogue' : ''}) ${u.sentence}`).join('\n')}`).join('\n\n');
    const key = { version: VERSION, system, user: sha256(user), profile, provider: { transport: provider.transport, endpoint: provider.endpoint, family: provider.family } };
    try {
      let output = await cache.read<string>('habits', key);
      if (output !== undefined && output !== null) cached++;
      else {
        requests++;
        // Ответ — решение по каждому id и целые предложения на замену: около трёхсот символов на вхождение.
        output = (await gateway.complete('habits', role, system, user, Math.max(4000, mine.length * 300))).text;
        await cache.write('habits', key, output);
      }
      const judged = judgeDecisions(output, mine, group, book, pack, reused);
      findings.push(...judged.findings);
      for (const reason of judged.discarded) discarded.push({ chapter: '', scene: '', reason });
    } catch (error) {
      if (error instanceof SpendRefused) { refused = true; break; }
      failures.push({ chapter: '', scene: '', reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { status: refused ? 'refused' : failures.length ? 'partial' : 'ok', habits: habits.length, uses: uses.length, requests, cached, failures, discarded, ledger: gateway.ledger, findings };
}

// Последний прогон Amendeor (findings/amendeor/latest.json): привычки для прореживания и все его находки как были —
// новый прогон пишется поверх latest и должен их сохранить, иначе ляпы прохода по книге пропадут из intake.
export async function latestBookRun(findingsDir: string, book: Book): Promise<{ items: GuideFinding[]; habits: Habit[] }> {
  const { readFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const dir = path.join(findingsDir, 'amendeor');
  const { run_id } = JSON.parse(await readFile(path.join(dir, 'latest.json'), 'utf8')) as { run_id: string };
  if (!/^[0-9TZ:-]+[0-9a-f]{4}$/u.test(run_id)) throw new Error('invalid amendeor latest run_id');
  const lines = (await readFile(path.join(dir, 'runs', run_id, 'findings.jsonl'), 'utf8')).split('\n').filter((l) => l.trim());
  const items: GuideFinding[] = [], habits: Habit[] = [];
  for (const line of lines) {
    const f = JSON.parse(line) as { id: string; category: string; severity: GuideFinding['severity']; summary: string; suggestion?: string; evidence: Array<{ type: string; text?: string }>; location: { primary: { chapter: string; scene: string } }; metadata: Record<string, unknown> };
    const quote = f.evidence.find((e) => e.type === 'quote')?.text;
    const scene = book.chapters.find((c) => c.slug === f.location.primary.chapter)?.scenes.find((s) => s.id === f.location.primary.scene);
    const start = quote && scene ? scene.text.indexOf(quote) : -1;
    if (!quote || !scene || start < 0) continue; // цитаты больше нет — находка устарела
    const principle = f.category.replace(/^style\./u, '');
    if (principle === 'book.thin') continue; // прежнее прореживание заменяется новым
    items.push({ id: String(f.metadata.signal ?? f.id), guide: (f.metadata.guide as GuideFinding['guide']) ?? 'book', principle, source_pages: '', chapter: f.location.primary.chapter, scene: f.location.primary.scene,
      start, end: start + quote.length, quote, reason: f.summary, provenance: String(f.metadata.provenance ?? ''), ...(f.severity ? { severity: f.severity } : {}),
      ...(f.suggestion ? { suggestion: f.suggestion } : {}), ...(typeof f.metadata.replacement === 'string' ? { replacement: f.metadata.replacement } : {}),
      ...(Array.isArray(f.metadata.patterns) ? { patterns: f.metadata.patterns as string[] } : {}) });
    if (principle === 'book.habit') {
      const patterns = habitPatterns(f.summary, f.suggestion, f.metadata.patterns);
      if (patterns.length) habits.push({ id: f.id, summary: f.summary, patterns });
    }
  }
  return { items, habits };
}
