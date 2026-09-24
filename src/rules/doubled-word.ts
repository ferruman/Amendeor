import type { Rule, ProposalDraft } from './index.ts';
import { inDialogue } from '../text/dialogue.ts';

export const doubledWord: Rule = {
  id: 'repetition.doubled-word', version: '2', langs: ['en', 'ru'], category: 'repetition', impact: 'mechanical',
  detect(scene, ctx): ProposalDraft[] {
    const drafts: ProposalDraft[] = [];
    for (const match of scene.text.matchAll(/(?<![\p{L}])([\p{L}]{2,})([ \t\r\n]+)\1(?![\p{L}])/giu)) {
      const start = match.index!;
      if (ctx.pack.language === 'en' && ['that', 'had'].includes(match[1]!.toLowerCase())) continue;
      if (ctx.config.preserve.includes('intentional-repetition') && inDialogue(ctx.dialogue, start, start + match[0].length)) continue;
      drafts.push({ target: match[0], replacement: match[1]!, start, reason: 'The same word appears twice in succession.' });
    }
    return drafts;
  }
};
