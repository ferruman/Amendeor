import type { Rule, ProposalDraft } from './index.ts';

export const dashesEllipsis: Rule = {
  id: 'typography.dashes-ellipsis', version: '4', langs: ['en', 'ru'], category: 'typography', impact: 'mechanical',
  detect(scene, ctx): ProposalDraft[] {
    const drafts: ProposalDraft[] = [];
    if (ctx.config.normalize.ellipsis) for (const match of scene.text.matchAll(/\.\.\./g)) drafts.push({ target: match[0], replacement: '…', start: match.index!, reason: 'Use the configured ellipsis.' });
    const dash = ctx.config.normalize.dashes ?? ctx.pack.dash.between_words;
    for (const match of scene.text.matchAll(/([\p{L}]) - ([\p{L}])/gu)) drafts.push({ target: match[0], replacement: `${match[1]} ${dash} ${match[2]}`, start: match.index!, reason: 'Use the language dash between clauses.' });
    // "May.. He": two full stops after a word that are not part of an ellipsis — a typo or the seam of a splice.
    // The target is the whole word, so the edit can be located as a token (locate refuses a span inside a word).
    for (const match of scene.text.matchAll(/(?<![\p{L}\p{N}])([\p{L}\p{N}]+)\.\.(?![.…])/gu)) drafts.push({ target: match[0], replacement: `${match[1]}.`, start: match.index!, reason: 'Two full stops are not an ellipsis; keep one.' });
    for (const match of scene.text.matchAll(/^-[ \t]+([\p{L}])/gmu)) drafts.push({ target: match[0], replacement: `${ctx.pack.dash.speech} ${match[1]}`, start: match.index!, reason: 'Use the language dialogue dash.' });
    return drafts;
  }
};
