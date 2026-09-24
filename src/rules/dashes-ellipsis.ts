import type { Rule, ProposalDraft } from './index.ts';

export const dashesEllipsis: Rule = {
  id: 'typography.dashes-ellipsis', version: '2', langs: ['en', 'ru'], category: 'typography', impact: 'mechanical',
  detect(scene, ctx): ProposalDraft[] {
    const drafts: ProposalDraft[] = [];
    if (ctx.config.normalize.ellipsis) for (const match of scene.text.matchAll(/\.\.\./g)) drafts.push({ target: match[0], replacement: '…', start: match.index!, reason: 'Use the configured ellipsis.' });
    const dash = ctx.config.normalize.dashes ?? ctx.pack.dash.between_words;
    for (const match of scene.text.matchAll(/([\p{L}]) - ([\p{L}])/gu)) drafts.push({ target: match[0], replacement: `${match[1]} ${dash} ${match[2]}`, start: match.index!, reason: 'Use the language dash between clauses.' });
    for (const match of scene.text.matchAll(/^-[ \t]+([\p{L}])/gmu)) drafts.push({ target: match[0], replacement: `${ctx.pack.dash.speech} ${match[1]}`, start: match.index!, reason: 'Use the language dialogue dash.' });
    return drafts;
  }
};
