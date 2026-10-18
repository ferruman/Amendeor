// Проход по всей книге за один вызов: то, чего не видно в окне. Ляп, который выдаёт только смысл абзаца
// («ritual» — четыре слога, чашки на сковородке, «booking photo» до ареста), и привычка всей книги — оборот,
// жест или рамка сравнения, повторённые до механичности («forty-five years» шестьдесят раз). Замер по двум
// независимым редакторским ревью — eval/book-pass: за вызов модель даёт около десятка пометок, почти все верные,
// и разные проходы находят разное, поэтому проходов по умолчанию два, а пометки объединяются.
// Это диагностика: ляп несёт предложенную правку в suggestion, но правит текст только edit по решению автора.
import { z } from 'zod';
import type { Book } from '../book.ts';
import type { LoadedConfig } from '../config.ts';
import type { LanguagePack } from '../lang/pack.ts';
import { Cache } from '../cache.ts';
import { Gateway } from '../provider/gateway.ts';
import { SpendRefused } from '../provider/meter.ts';
import { parseModelJson } from '../provider/json.ts';
import { sha256 } from '../hash.ts';
import type { GuideFinding } from './guide.ts';

const VERSION = 'book-pass-2';

const markSchema = z.object({
  kind: z.enum(['slip', 'habit']),
  chapter: z.string(),
  quote: z.string().min(3),
  problem: z.string().min(1),
  fix: z.string().optional(),
  replacement: z.string().nullable().optional(),
  count: z.number().optional(),
});
const answerSchema = z.object({ marks: z.array(z.unknown()).default([]) });

export const BOOK_PASS_SYSTEM = `You are the copy editor of a publishing house. You have read the complete novel below, and before it goes to proofs you mark what a careful line and copy editor marks — the language, not the plot.

Two kinds of problem.
1. Slips that only the sense of the passage reveals: a word that cannot mean what the sentence needs (an object that cannot do what it does, a term used wrongly for its context), a count or description of language that is wrong ("four syllables" for a three-syllable word, "twice" before three items), clock or number arithmetic inside a sentence, a line of dialogue with no clear speaker or the wrong form of address, a pronoun that gives a character the wrong gender, a sentence or paragraph that contradicts itself, a stock phrase that does not fit the character it describes.
2. The book's verbal habits: words, phrases, similes, gestures and sentence frames repeated so often across the book that they turn mechanical ("the way…", a recurring number, a gesture every character makes). Name the habit, estimate how often it occurs, quote one occurrence, and say which uses to keep.

Do not mark: dialect or nonstandard grammar in dialogue that renders speech, a refrain the book clearly builds on purpose, matters of plot, continuity across chapters or legal accuracy (other readers do that), or a preference the text does not violate.

Be exhaustive: a careful copy edit of a novel marks many slips and several habits. Do not pad.

Write "problem" and "fix" in the language the manuscript is written in.

For a slip, "replacement" is the quoted sentence with only the error corrected and every other character unchanged, so that it can replace the quote as it stands; give null when the correction is not a change inside that sentence (moving a passage, a change elsewhere).

Reply with JSON only: { "marks": [{ "kind": "slip|habit", "chapter": "<id>", "quote": "<one sentence copied character for character>", "problem": "…", "fix": "the minimal correction, or for a habit which uses to cut", "replacement": "<slips only: the corrected sentence, or null>", "count": <estimated occurrences, habits only> }] }`;

export interface BookPassFinding extends GuideFinding { kind: 'contextual'; suggestion?: string; confidence: number }
export interface BookPassResult {
  status: 'ok' | 'partial' | 'refused';
  passes: number;
  cached: number;
  failures: Array<{ chapter: string; scene: string; reason: string }>;
  discarded: Array<{ chapter: string; scene: string; reason: string }>;
  ledger: Gateway['ledger'];
  findings: BookPassFinding[];
}

export const bookPassUser = (book: Book) => book.chapters.map((c) => `=== ${c.slug} · ${c.title} ===\n\n${c.text}`).join('\n\n');

// Цитата ищется в названной главе, иначе во всей книге; засчитывается, только если в сцене она одна.
function locate(book: Book, chapterSlug: string, quote: string) {
  const ordered = [...book.chapters.filter((c) => c.slug === chapterSlug), ...book.chapters.filter((c) => c.slug !== chapterSlug)];
  for (const chapter of ordered) for (const scene of chapter.scenes) {
    const start = scene.text.indexOf(quote);
    if (start >= 0 && start === scene.text.lastIndexOf(quote)) return { chapter, scene, start };
  }
  return null;
}

export function toBookPassFindings(book: Book, output: string): { findings: BookPassFinding[]; discarded: string[] } {
  const findings: BookPassFinding[] = [], discarded: string[] = [];
  for (const raw of answerSchema.parse(parseModelJson(output)).marks) {
    const mark = markSchema.safeParse(raw);
    if (!mark.success) { discarded.push('mark breaks the schema'); continue; }
    const { kind, chapter, problem, fix, count, replacement } = mark.data;
    const quote = mark.data.quote.trim();
    const at = locate(book, chapter, quote);
    if (!at) { discarded.push(`quote not found once in a scene: ${quote.slice(0, 60)}`); continue; }
    const reason = kind === 'habit' && count ? `${problem} (≈${count}×)` : problem;
    findings.push({
      id: sha256(`${at.chapter.slug}\n${at.scene.id}\n${at.start}\nbook.${kind}\n${quote}`), guide: 'book', kind: 'contextual',
      principle: `book.${kind}`, source_pages: '', chapter: at.chapter.slug, scene: at.scene.id,
      start: at.start, end: at.start + quote.length, quote, reason, provenance: 'whole-book pass',
      // Ляп — конкретная ошибка с правкой; привычка — совет на всю книгу, поэтому ниже.
      severity: kind === 'slip' ? 'medium' : 'low', confidence: 0.7,
      ...(fix ? { suggestion: fix } : {}),
      // Замена годится в правку, только если это та же фраза с исправлением, а не пересказ правки.
      ...(kind === 'slip' && replacement && replacement.trim() && replacement.trim() !== quote ? { replacement: replacement.trim() } : {}),
    });
  }
  return { findings, discarded };
}

export async function checkBookPass(book: Book, pack: LanguagePack, loaded: LoadedConfig, stateDir: string, noCache = false, passes = 2): Promise<BookPassResult> {
  const profile = loaded.config.profiles.book ?? loaded.config.profiles.edit;
  if (!profile) throw new Error('book pass requires profiles.book (or profiles.edit); use --rules-only to skip it');
  const provider = loaded.config.providers[profile.provider];
  if (!provider) throw new Error(`provider ${profile.provider} missing`);
  if (provider.transport !== 'local' && provider.api_key_env && !process.env[provider.api_key_env] && !provider.api_key && !provider.api_key_file) throw new Error(`${provider.api_key_env} is missing`);
  const role = loaded.config.profiles.book ? 'book' : 'edit';
  const gateway = new Gateway(loaded.config, pack);
  const cache = new Cache(stateDir, noCache);
  const user = bookPassUser(book);
  const failures: BookPassResult['failures'] = [], discarded: BookPassResult['discarded'] = [];
  const byPlace = new Map<string, BookPassFinding>();
  let cached = 0, refused = false;
  for (let pass = 0; pass < passes && !refused; pass++) {
    const key = { version: VERSION, system: BOOK_PASS_SYSTEM, text: sha256(user), pass, profile, provider: { transport: provider.transport, endpoint: provider.endpoint, family: provider.family } };
    try {
      let output = await cache.read<string>('book-pass', key);
      if (output !== undefined && output !== null) cached++;
      else {
        // Ответ на всю книгу длинный и требует рассуждения: бюджет выхода — около тридцати тысяч символов.
        output = (await gateway.complete(`book-pass-${pass + 1}`, role, BOOK_PASS_SYSTEM, user, 30_000)).text;
        await cache.write('book-pass', key, output);
      }
      const parsed = toBookPassFindings(book, output);
      for (const reason of parsed.discarded) discarded.push({ chapter: '', scene: '', reason });
      // Объединение проходов: одна пометка на место и вид — первая остаётся.
      for (const f of parsed.findings) { const place = `${f.chapter}/${f.scene}/${f.start}/${f.principle}`; if (!byPlace.has(place)) byPlace.set(place, f); }
    } catch (error) {
      if (error instanceof SpendRefused) { refused = true; break; }
      failures.push({ chapter: '', scene: '', reason: `pass ${pass + 1}: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  // id сцены уникален только внутри главы
  const order = new Map(book.chapters.flatMap((c) => c.scenes.map((s) => `${c.slug}/${s.id}`)).map((id, i) => [id, i]));
  const at = (f: BookPassFinding) => order.get(`${f.chapter}/${f.scene}`) ?? 0;
  const findings = [...byPlace.values()].sort((a, b) => at(a) - at(b) || a.start - b.start);
  return { status: refused ? 'refused' : failures.length ? 'partial' : 'ok', passes, cached, failures, discarded, ledger: gateway.ledger, findings };
}
