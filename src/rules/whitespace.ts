import type { Rule, ProposalDraft } from './index.ts';

export const whitespace: Rule = {
  id: 'typography.whitespace', version: '1', langs: ['en', 'ru'], category: 'typography', impact: 'mechanical', authority: 'mechanical',
  detect(scene): ProposalDraft[] {
    const drafts: ProposalDraft[] = [];
    for (const match of scene.text.matchAll(/([\p{L}\p{N}]) {2,}([^\s])/gu)) drafts.push({ target: match[0], replacement: `${match[1]} ${match[2]}`, start: match.index!, reason: 'Collapse repeated spaces.' });
    // Not before a digit: `A .38`, `the .45` are calibers and `at .5 percent` a decimal (The Arrangement).
    for (const match of scene.text.matchAll(/([\p{L}\p{N}])[ \t]+([,.;:!?])(?!\p{N})/gu)) drafts.push({ target: match[0], replacement: `${match[1]}${match[2]}`, start: match.index!, reason: 'Remove space before punctuation.' });
    for (const match of scene.text.matchAll(/([^\s])[ \t]+(?=\r?$)/gm)) drafts.push({ target: match[0], replacement: match[1]!, start: match.index!, reason: 'Remove trailing spaces.' });
    return drafts;
  }
};
