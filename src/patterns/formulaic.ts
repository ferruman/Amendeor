import type { Book } from '../book.ts';
import type { LanguagePack } from '../lang/pack.ts';
import { dialogueSpans } from '../text/dialogue.ts';

export const formulaicCatalogVersion = '0.2.0';
export const formulaicCatalogProvenance = 'docs/prose-patterns.md (local adaptation; see source and MIT license links)';
export interface FormulaicHit {
  id: string;
  language: string;
  provenance: string;
  chapter: string;
  scene: string;
  start: number;
  end: number;
  quote: string;
  reason: string;
}

interface PatternDefinition { id: string; language: 'en' | 'ru'; expression: RegExp; reason: string }

// Это узкие сигналы для проверки человеком, а не доказательство происхождения текста.
const patterns: PatternDefinition[] = [
  { id: 'formulaic.throat-clearing', language: 'en', expression: /\b(?:here['’]s the thing|let me be clear)(?=\b|[,:.!?])/giu, reason: 'Generic opening delays the point.' },
  { id: 'formulaic.faux-insight', language: 'en', expression: /\b(?:what nobody tells you|the part everyone misses)(?=\b|[,:.!?])/giu, reason: 'The setup claims special insight without adding it.' },
  { id: 'formulaic.importance-puffery', language: 'en', expression: /\b(?:marks? a pivotal moment|stands? as a testament to)\b/giu, reason: 'The phrase labels importance instead of showing the event.' },
  { id: 'formulaic.filler-frame', language: 'en', expression: /\b(?:at the end of the day|in today['’]s world|it['’]s worth noting that)\b/giu, reason: 'A stock frame may add no information.' },
  { id: 'formulaic.faux-insight', language: 'ru', expression: /(?:вот о чём никто не говорит|мало кто говорит о том, что)/giu, reason: 'Зачин обещает особое знание, не добавляя факта.' },
  { id: 'formulaic.importance-puffery', language: 'ru', expression: /(?:знаменует собой поворотный момент|служит ярким свидетельством)/giu, reason: 'Фраза объявляет событие важным вместо конкретного объяснения.' },
  { id: 'formulaic.filler-frame', language: 'ru', expression: /(?:в современном мире|необходимо отметить, что)/giu, reason: 'Шаблонная рамка может не добавлять информации.' }
];

export function scanFormulaicProse(book: Book, pack: LanguagePack): FormulaicHit[] {
  const relevant = patterns.filter((pattern) => pattern.language === pack.language);
  const hits: FormulaicHit[] = [];
  for (const chapter of book.chapters) for (const scene of chapter.scenes) {
    const dialogue = dialogueSpans(scene.text, pack);
    const sceneHits: FormulaicHit[] = [];
    for (const pattern of relevant) for (const match of scene.text.matchAll(pattern.expression)) {
      const start = match.index!;
      const end = start + match[0].length;
      if (dialogue.some((span) => start < span.end && end > span.start)) continue;
      sceneHits.push({ id: pattern.id, language: pattern.language, provenance: formulaicCatalogProvenance, chapter: chapter.slug, scene: scene.id, start, end, quote: match[0], reason: pattern.reason });
    }
    hits.push(...sceneHits.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id)));
  }
  return hits;
}
