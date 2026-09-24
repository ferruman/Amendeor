import type { Rule, ProposalDraft } from './index.ts';

export const quotes: Rule = {
  id: 'typography.quotes', version: '2', langs: ['en', 'ru'], category: 'typography', impact: 'mechanical',
  detect(scene, ctx): ProposalDraft[] {
    const desired = ctx.config.normalize.quotes;
    if (!desired || desired === 'keep' || desired === '""') return [];
    const pair = [...desired];
    if (pair.length !== 2) return [];
    const nested = ctx.pack.quote_pairs[1] ?? pair;
    const drafts: ProposalDraft[] = [];
    for (const match of scene.text.matchAll(/"([^"\r\n]+)"|“([^”\r\n]+)”/g)) {
      const inner = (match[1] ?? match[2]!).replace(/‘([^’]+)’/g, `${nested[0]}$1${nested[1]}`);
      const replacement = `${pair[0]}${inner}${pair[1]}`;
      if (replacement !== match[0]) drafts.push({ target: match[0], replacement, start: match.index!, reason: 'Use the configured outer and nested quotation marks.' });
    }
    return drafts;
  }
};
