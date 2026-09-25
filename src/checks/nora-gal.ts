import type { Book } from '../book.ts';
import type { LanguagePack } from '../lang/pack.ts';
import { dialogueSpans } from '../text/dialogue.ts';

export const noraGalGuideVersion = '0.1.0';
export const noraGalGuideSource = 'docs/nora-gal-check.md';

export interface NoraGalFinding {
  id: string;
  guide: 'nora-gal';
  chapter: string;
  scene: string;
  start: number;
  end: number;
  quote: string;
  reason: string;
  provenance: string;
}

interface Signal { id: string; expression: RegExp; reason: string }

// Сигналы отмечают оборот для перечитывания; контекст может его оправдывать.
const signals: Signal[] = [
  {
    id: 'office.action-noun',
    expression: /(?<![\p{L}\p{N}_])(?:осуществля(?:ть|ет|ют|л[аио]?|ли)|производ(?:ить|ит|ят|ил[аио]?|или))\s+(?:проверку|осмотр|поиск|контроль|наблюдение|мероприятия)(?![\p{L}\p{N}_])/giu,
    reason: 'Тяжеловесное сочетание глагола и существительного: проверьте, можно ли назвать действие прямо и сохранить смысл.'
  },
  {
    id: 'office.purpose-frame',
    expression: /(?<![\p{L}\p{N}_])в\s+целях\s+(?:осуществления|проведения|обеспечения|повышения|улучшения|реализации)(?![\p{L}\p{N}_])/giu,
    reason: 'Канцелярская рамка цели: проверьте, нужна ли она в этой фразе.'
  },
  {
    id: 'office.empty-existence',
    expression: /(?<![\p{L}\p{N}_])име(?:ет|ют|л[аои]?)\s+место(?![\p{L}\p{N}_])/giu,
    reason: 'Оборот может скрывать конкретное событие: проверьте, можно ли назвать его точнее.'
  }
];

export function checkNoraGal(book: Book, pack: LanguagePack): NoraGalFinding[] {
  if (pack.language !== 'ru') return [];
  const findings: NoraGalFinding[] = [];
  for (const chapter of book.chapters) for (const scene of chapter.scenes) {
    const dialogue = dialogueSpans(scene.text, pack);
    const sceneFindings: NoraGalFinding[] = [];
    for (const signal of signals) for (const match of scene.text.matchAll(signal.expression)) {
      const start = match.index!;
      const end = start + match[0].length;
      if (dialogue.some((span) => start < span.end && end > span.start)) continue;
      sceneFindings.push({
        id: signal.id, guide: 'nora-gal', chapter: chapter.slug, scene: scene.id,
        start, end, quote: match[0], reason: signal.reason, provenance: noraGalGuideSource
      });
    }
    findings.push(...sceneFindings.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id)));
  }
  return findings;
}
