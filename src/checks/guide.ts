import type { Book } from '../book.ts';
import type { LanguagePack } from '../lang/pack.ts';
import { dialogueSpans } from '../text/dialogue.ts';

export type GuideId = 'nora-gal' | 'infostyle' | 'en-fiction-editing' | 'en-clarity' | 'en-prose-style';
export type GuideSeverity = 'medium' | 'low' | 'info';

export interface GuideFinding {
  id: string;
  guide: GuideId;
  principle: string;
  source_pages: string;
  chapter: string;
  scene: string;
  start: number;
  end: number;
  quote: string;
  reason: string;
  provenance: string;
  severity?: GuideSeverity;
}

export interface Signal { id: string; principle: string; sourcePages: string; expression: RegExp; reason: string }

// Гайд — каталог принципов из книги, узкие сигналы и указания для контекстного прохода.
export interface Guide {
  id: GuideId;
  // Язык рукописи, к которой применим гайд; на другом языке гайд не запускается.
  language: 'ru' | 'en';
  name: string;
  version: string;
  contextVersion: string;
  source: string;
  prefix: string;
  minPrinciples: number;
  // Дополняет «Выполняй диагностику по …» (или «Diagnose the passage by …») в промпте.
  byline: string;
  signals: Signal[];
  scanRules: string[];
  verifyRules: string[];
  // Находки внутри прямой речи отбрасываются: книга не про голос персонажей.
  narrationOnly: boolean;
}

// Сигналы отмечают оборот для перечитывания; контекст может его оправдывать.
export function checkGuide(guide: Guide, book: Book, pack: LanguagePack): GuideFinding[] {
  if (pack.language !== guide.language) return [];
  const findings: GuideFinding[] = [];
  for (const chapter of book.chapters) for (const scene of chapter.scenes) {
    const dialogue = dialogueSpans(scene.text, pack);
    const sceneFindings: GuideFinding[] = [];
    for (const signal of guide.signals) for (const match of scene.text.matchAll(signal.expression)) {
      const start = match.index!;
      const end = start + match[0].length;
      if (dialogue.some((span) => start < span.end && end > span.start)) continue;
      sceneFindings.push({
        id: signal.id, guide: guide.id, principle: signal.principle, source_pages: signal.sourcePages,
        chapter: chapter.slug, scene: scene.id,
        start, end, quote: match[0], reason: signal.reason, provenance: guide.source
      });
    }
    findings.push(...sceneFindings.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id)));
  }
  return findings;
}

// Одна находка на принцип и место: тот же принцип в той же сцене на перекрывающемся фрагменте — остаётся первая
// (узкий сигнал идёт раньше модели). Разные принципы на одном месте — разные замечания.
export function dedupeFindings<T extends GuideFinding>(items: T[]): T[] {
  const kept: T[] = [];
  for (const item of items) {
    if (!kept.some((other) => other.chapter === item.chapter && other.scene === item.scene && other.principle === item.principle && item.start < other.end && item.end > other.start)) kept.push(item);
  }
  return kept;
}
