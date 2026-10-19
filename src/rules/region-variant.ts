import type { Rule, ProposalDraft } from './index.ts';
import { inDialogue } from '../text/dialogue.ts';
import { regionalHits } from '../lang/en/regional.ts';

// Слово или написание другого региона в книге с тегом en-US / en-GB. Правка — решение автора по месту; форма,
// которую регион книги тоже пишет (autumn, cancelled), и всё в прямой речи (голос персонажа может быть
// британским) — только находка. Многозначная (flat, lift, post) в тексте не сигнал: на Shepherd's Silence это 63
// прилагательных «flat» и ни одной квартиры — пропускается. Четыре пары пакета ведёт consistency.spelling-variant.
export const regionVariant: Rule = {
  id: 'consistency.region-variant', version: '1', langs: ['en'], category: 'consistency', impact: 'prose', authority: 'contextual',
  detect(scene, ctx): ProposalDraft[] {
    const packPairs = new Set(ctx.pack.spelling_variants.flat());
    return regionalHits(scene.text, ctx.book.lang).filter((h) => !h.polysemous && !packPairs.has(h.form.toLowerCase())).map((h) => {
      const finding = h.loose || inDialogue(ctx.dialogue, h.index, h.index + h.form.length);
      return {
        target: h.form, start: h.index,
        replacement: /^\p{Lu}/u.test(h.form) ? h.other[0]!.toLocaleUpperCase() + h.other.slice(1) : h.other,
        reason: `${h.kind === 'spelling' ? 'Spelling' : 'Usage'} of the other English region; the book is ${ctx.book.lang}.${h.loose ? ` "${h.form}" is also written there: keep it if it is meant.` : ''}`,
        authority: finding ? 'semantic' as const : 'contextual' as const,
        ...(finding ? { evidence: { basis: h.loose ? 'form also written in the book’s region' : 'in dialogue: may be the character’s voice', region_form: h.other } } : {}),
      };
    });
  }
};
