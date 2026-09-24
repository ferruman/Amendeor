import type { Rule, ProposalDraft } from './index.ts';
import { paragraphs } from '../text/segment.ts';

export const markdown: Rule = {
  id: 'markdown.stray-marker', version: '2', langs: ['en', 'ru'], category: 'typography', impact: 'mechanical',
  detect(scene): ProposalDraft[] {
    const drafts: ProposalDraft[] = [];
    for (const paragraph of paragraphs(scene.text)) {
      for (const match of paragraph.text.matchAll(/([^\s])\s+(#{2,})\s+([\p{L}])/gu)) {
        drafts.push({ target: match[0], replacement: `${match[1]} ${match[3]}`, start: paragraph.start + match.index!, reason: 'Remove heading markers inside a paragraph.' });
      }
      const bold = [...paragraph.text.matchAll(/\*\*/g)];
      if (bold.length === 1) {
        const match = bold[0]!; const before = paragraph.text[match.index! - 1] ?? ''; const after = paragraph.text[match.index! + 2] ?? '';
        if (before && after && /\p{L}/u.test(before) && /\p{L}/u.test(after)) drafts.push({ target: `${before}**${after}`, replacement: `${before}${after}`, start: paragraph.start + match.index! - 1, reason: 'Remove a stray bold marker.' });
      }
      if ((paragraph.text.match(/_/g) ?? []).length === 1) for (const match of paragraph.text.matchAll(/([\p{L}])_(?=[ \t]|$)/gu)) drafts.push({ target: match[0], replacement: match[1]!, start: paragraph.start + match.index!, reason: 'Remove a stray emphasis marker.' });
      for (const match of paragraph.text.matchAll(/([\p{L}])\\([!?])/gu)) drafts.push({ target: match[0], replacement: `${match[1]}${match[2]}`, start: paragraph.start + match.index!, reason: 'Remove an unnecessary Markdown escape.' });
    }
    return drafts;
  }
};
