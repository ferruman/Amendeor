import type { Rule, ProposalDraft } from './index.ts';
import { paragraphs } from '../text/segment.ts';

export function balanceWarnings(text: string): string[] {
  const warnings: string[] = [];
  for (const paragraph of paragraphs(text)) {
    for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']]) {
      const left = [...paragraph.text].filter((char) => char === open).length;
      const right = [...paragraph.text].filter((char) => char === close).length;
      if (left !== right) warnings.push(`unbalanced ${open}${close} at ${paragraph.start}`);
    }
    const quotes = (paragraph.text.match(/[“”«»"]/g) ?? []).length;
    if (quotes % 2) warnings.push(`unbalanced quotes at ${paragraph.start}`);
  }
  return warnings;
}

export const balance: Rule = {
  id: 'punctuation.balance', version: '2', langs: ['en', 'ru'], category: 'punctuation', impact: 'mechanical',
  detect(scene): ProposalDraft[] {
    const drafts: ProposalDraft[] = [];
    for (const paragraph of paragraphs(scene.text)) {
      for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']]) {
        const left = [...paragraph.text].filter((char) => char === open).length;
        const right = [...paragraph.text].filter((char) => char === close).length;
        if (left !== right + 1 || paragraph.text.indexOf(open) < 0) continue;
        const tail = paragraph.text.match(/[\p{L}\p{N}]+[.!?]?$/u)?.[0];
        if (!tail) continue;
        const replacement = /[.!?]$/.test(tail) ? `${tail.slice(0, -1)}${close}${tail.slice(-1)}` : `${tail}${close}`;
        drafts.push({ target: tail, replacement, start: paragraph.end - tail.length, reason: `Close the unmatched ${open}.` });
      }
    }
    return drafts;
  }
};
