import type { Book } from '../book.ts';
import type { LanguagePack } from '../lang/pack.ts';
import { checkGuide, type Guide, type GuideFinding } from './guide.ts';

export const noraGalGuideVersion = '0.2.0';
export const noraGalGuideSource = 'docs/nora-gal-principles.md';
export type NoraGalFinding = GuideFinding;

export const noraGal: Guide = {
  id: 'nora-gal', name: 'Nora Gal', version: noraGalGuideVersion, contextVersion: '0.2.0', source: noraGalGuideSource,
  prefix: 'gal', minPrinciples: 25, byline: 'принципам Норы Галь', narrationOnly: false,
  signals: [
    {
      id: 'office.action-noun',
      principle: 'gal.action-noun', sourcePages: '7–10',
      expression: /(?<![\p{L}\p{N}_])(?:осуществля(?:ть|ет|ют|л[аио]?|ли)|производ(?:ить|ит|ят|ил[аио]?|или))\s+(?:проверку|осмотр|поиск|контроль|наблюдение|мероприятия)(?![\p{L}\p{N}_])/giu,
      reason: 'Тяжеловесное сочетание глагола и существительного: проверьте, можно ли назвать действие прямо и сохранить смысл.'
    },
    {
      id: 'office.purpose-frame',
      principle: 'gal.office-register', sourcePages: '3–7, 12–14',
      expression: /(?<![\p{L}\p{N}_])в\s+целях\s+(?:осуществления|проведения|обеспечения|повышения|улучшения|реализации)(?![\p{L}\p{N}_])/giu,
      reason: 'Канцелярская рамка цели: проверьте, нужна ли она в этой фразе.'
    },
    {
      id: 'office.empty-existence',
      principle: 'gal.office-register', sourcePages: '3–7, 12–14',
      expression: /(?<![\p{L}\p{N}_])име(?:ет|ют|л[аои]?)\s+место(?![\p{L}\p{N}_])/giu,
      reason: 'Оборот может скрывать конкретное событие: проверьте, можно ли назвать его точнее.'
    }
  ],
  scanRules: [],
  verifyRules: ['Для gal.ambiguity требуй двух грамматически возможных трактовок с разным смыслом. Для gal.image-consistency требуй реального противоречия свойств образа.']
};

export function checkNoraGal(book: Book, pack: LanguagePack): NoraGalFinding[] {
  return checkGuide(noraGal, book, pack);
}
