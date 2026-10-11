import type { Rule, ProposalDraft } from './index.ts';
import { words } from '../text/segment.ts';

export const spellingVariant: Rule = {
  id: 'consistency.spelling-variant', version: '2', langs: ['en', 'ru'], category: 'consistency', impact: 'mechanical', authority: 'contextual',
  detect(scene, ctx): ProposalDraft[] {
    const drafts: ProposalDraft[] = [];
    const counts = ctx.wordCounts;
    const preferred = new Map<string, string>();
    for (const [a, b] of ctx.pack.spelling_variants) {
      const forced = ctx.config.normalize.spelling;
      const winner = forced === 'british' ? a : forced === 'american' ? b : (counts.get(a) ?? 0) >= (counts.get(b) ?? 0) ? a : b;
      if ((counts.get(a) ?? 0) && (counts.get(b) ?? 0) || forced) preferred.set(winner === a ? b : a, winner);
    }
    for (const token of words(scene.text)) {
      const replacement = preferred.get(token.lower);
      // Заданное автором написание — механика; выбранное по частоте в книге — решение по контексту.
      if (replacement) drafts.push({ target: token.text, replacement: /^\p{Lu}/u.test(token.text) ? replacement[0]!.toLocaleUpperCase() + replacement.slice(1) : replacement, start: token.start, reason: 'Use the book or configured spelling variant.', authority: ctx.config.normalize.spelling ? 'mechanical' : 'contextual' });
      if (ctx.pack.language === 'ru' && ctx.config.normalize.yo !== 'keep') {
        const changed = ctx.config.normalize.yo === 'e' ? token.text.replace(/ё/g, 'е').replace(/Ё/g, 'Е') : token.text.replace(/е/g, 'ё').replace(/Е/g, 'Ё');
        // ё → е по настройке смысла не меняет; е → ё может сделать из слова другое (все → всё, небо → нёбо) — только находка.
        if (changed !== token.text && (ctx.config.normalize.yo === 'e' || counts.has(changed.toLowerCase()))) drafts.push({ target: token.text, replacement: changed, start: token.start, reason: 'Use the configured ё/е spelling.',
          ...(ctx.config.normalize.yo === 'e' ? { authority: 'mechanical' as const } : { authority: 'semantic' as const, evidence: { basis: 'е→ё form present in the book', form_in_book: changed.toLowerCase(), count_in_book: counts.get(changed.toLowerCase()) ?? 0 } }) });
      }
    }
    return drafts;
  }
};
