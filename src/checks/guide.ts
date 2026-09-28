import type { Book } from '../book.ts';
import type { LanguagePack } from '../lang/pack.ts';
import { dialogueSpans } from '../text/dialogue.ts';

export type GuideId = 'nora-gal' | 'infostyle';

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
}

export interface Signal { id: string; principle: string; sourcePages: string; expression: RegExp; reason: string }

// Гайд — каталог принципов из книги, узкие сигналы и указания для контекстного прохода.
export interface Guide {
  id: GuideId;
  name: string;
  version: string;
  contextVersion: string;
  source: string;
  prefix: string;
  minPrinciples: number;
  // Дополняет «Выполняй диагностику по …» в промпте.
  byline: string;
  signals: Signal[];
  scanRules: string[];
  verifyRules: string[];
  // Находки внутри прямой речи отбрасываются: книга не про голос персонажей.
  narrationOnly: boolean;
}

// Сигналы отмечают оборот для перечитывания; контекст может его оправдывать.
export function checkGuide(guide: Guide, book: Book, pack: LanguagePack): GuideFinding[] {
  if (pack.language !== 'ru') return [];
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
