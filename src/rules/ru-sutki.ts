import type { Rule, ProposalDraft } from './index.ts';
import { inDialogue } from '../text/dialogue.ts';

const numeral = /(?<![\p{L}\p{N}])(два|две|три|четыре)((?:\s+[\p{L}-]+(?:ых|их)){0,3})\s+суток(?![\p{L}])/giu;
const collective: Record<string, string> = { два: 'двое', две: 'двое', три: 'трое', четыре: 'четверо' };

export const ruSutki: Rule = {
  id: 'grammar.ru-sutki-numeral', version: '1', langs: ['ru'], category: 'grammar', impact: 'mechanical',
  detect(scene, ctx): ProposalDraft[] {
    return [...scene.text.matchAll(numeral)].filter((match) => !inDialogue(ctx.dialogue, match.index!, match.index! + match[0]!.length)).map((match) => {
      const number = match[1]!;
      const word = collective[number.toLocaleLowerCase('ru')]!;
      const replacement = (/^\p{Lu}/u.test(number) ? word[0]!.toLocaleUpperCase('ru') + word.slice(1) : word) + match[0]!.slice(number.length);
      return { target: match[0]!, replacement, start: match.index!, reason: 'С существительным «сутки» в этой форме употребляется собирательное числительное.' };
    });
  }
};
