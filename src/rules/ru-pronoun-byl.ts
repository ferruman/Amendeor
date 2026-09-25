import type { Rule, ProposalDraft } from './index.ts';
import { inDialogue } from '../text/dialogue.ts';

const pattern = /(?<![\p{L}])(он|она|оно|они)([ \t]+)(был|была|было|были)(?![\p{L}])/giu;
const expected: Record<string, string> = { он: 'был', она: 'была', оно: 'было', они: 'были' };

export const ruPronounByl: Rule = {
  id: 'grammar.ru-pronoun-byl', version: '1', langs: ['ru'], category: 'grammar', impact: 'mechanical',
  detect(scene, ctx): ProposalDraft[] {
    const drafts: ProposalDraft[] = [];
    for (const match of scene.text.matchAll(pattern)) {
      const start = match.index!;
      if (inDialogue(ctx.dialogue, start, start + match[0]!.length)) continue;
      const correct = expected[match[1]!.toLocaleLowerCase('ru')]!;
      if (match[3]!.toLocaleLowerCase('ru') === correct) continue;
      drafts.push({ target: match[0]!, replacement: match[1]! + match[2]! + correct, start, reason: 'Форма прошедшего времени «быть» должна согласоваться с местоимением.' });
    }
    return drafts;
  }
};
