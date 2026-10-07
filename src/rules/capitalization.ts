import type { Rule, ProposalDraft } from './index.ts';

export const capitalization: Rule = {
  id: 'capitalization.sentence-start', version: '3', langs: ['en', 'ru'], category: 'capitalization', impact: 'mechanical',
  detect(scene, ctx): ProposalDraft[] {
    const drafts: ProposalDraft[] = [];
    const abbreviations = new Set(ctx.pack.abbreviations.map((word) => word.toLowerCase()));
    for (const match of scene.text.matchAll(/([.!?])([ \t\r\n]+)([\p{Ll}][\p{L}]*)/gu)) {
      if (match[1] !== '.' && !/[\r\n]/.test(match[2]!)) continue;
      const prefix = scene.text.slice(0, match.index! + 1).match(/[\p{L}.]+$/u)?.[0]?.toLowerCase() ?? '';
      if (abbreviations.has(prefix) || /(?:^|\s)\p{Lu}\.$/u.test(scene.text.slice(Math.max(0, match.index! - 3), match.index! + 1))) continue;
      const word = match[3]!;
      drafts.push({ target: match[0], replacement: `${match[1]}${match[2]}${word[0]!.toLocaleUpperCase()}${word.slice(1)}`, start: match.index!, reason: 'Capitalize the sentence opening.' });
    }
    return drafts;
  }
};
