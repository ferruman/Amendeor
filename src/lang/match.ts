// Написан ли ответ модели на языке рукописи? Модели сбиваются на чужой язык: проход по всей книге The Shepherd's
// Silence (en) вернул пять пояснений из девяти по-французски; в Esgardeor то же было с русским, испанским и
// португальским. Язык нигде не назван: мерило — сама рукопись (её письменность и начала её слов) и служебные
// слова пакета языка книги. Тот же способ, что Esgardeor lang/match.ts (d28327a), где он измерен на восьми книгах:
// в английских все срабатывания были утечками, в русских — 5 коротких назывных фраз примерно из 5000.
//
// ponytail: начало слова из пяти букв — грубая основа, пороги 0.35×/0.5 подобраны на тех восьми книгах;
// языку с длинными сложными словами (немецкий) или без пробелов (китайский) понадобятся свои числа.

const SCRIPTS = ['Latin', 'Cyrillic', 'Greek', 'Arabic', 'Hebrew', 'Armenian', 'Georgian', 'Devanagari', 'Thai', 'Han', 'Hiragana', 'Katakana', 'Hangul'] as const;
const SCRIPT_RE = SCRIPTS.map((s) => [s, new RegExp(`\\p{Script=${s}}`, 'gu')] as const);
const MIN_LETTERS = 12, MIN_LONG_WORDS = 6, COVERAGE_CUT = 0.5, STOPWORD_FACTOR = 0.35;

export interface LanguageProfile { script: string; prefixes: Set<string>; stopwords: Set<string> | null; threshold: number }

// токены с цифрами — идентификаторы, время и счёт, а не язык
const clean = (s: string) => s.replace(/\S*\d\S*/gu, ' ');
const wordsOf = (s: string) => clean(s).toLowerCase().match(/[\p{L}\p{M}]+/gu) ?? [];
const prefix = (w: string) => Array.from(w).slice(0, 5).join('');

function dominantScript(s: string): string | null {
  let best: string | null = null, n = 0;
  for (const [name, re] of SCRIPT_RE) { const k = s.match(re)?.length ?? 0; if (k > n) { best = name; n = k; } }
  return best;
}

export function languageProfile(manuscript: string, stopwords: readonly string[] | null): LanguageProfile {
  const words = wordsOf(manuscript);
  const sw = stopwords?.length ? new Set(stopwords.map((w) => w.toLowerCase())) : null;
  const share = sw && words.length ? words.filter((w) => sw.has(w)).length / words.length : 0;
  return { script: dominantScript(manuscript) ?? 'Latin', prefixes: new Set(words.map(prefix)), stopwords: sw, threshold: STOPWORD_FACTOR * share };
}

/** Первая человекочитаемая строка не на языке книги, иначе null. */
export function wrongLanguage(values: readonly string[], p: LanguageProfile): string | null {
  for (const s of values) {
    if (!/\s/u.test(s.trim()) || /[{}[\]]/u.test(s)) continue; // идентификаторы, ярлыки, разметка
    const text = clean(s);
    if ((text.match(/\p{L}/gu)?.length ?? 0) < MIN_LETTERS) continue;
    if (dominantScript(text) !== p.script) return s;
    const sw = p.stopwords;
    if (!sw) continue;
    const words = wordsOf(s);
    const long = words.filter((w) => Array.from(w).length >= 4);
    if (long.length < MIN_LONG_WORDS) continue;
    const coverage = long.filter((w) => p.prefixes.has(prefix(w))).length / long.length;
    const functional = words.filter((w) => sw.has(w)).length / words.length;
    if (coverage < COVERAGE_CUT && functional < p.threshold) return s;
  }
  return null;
}
