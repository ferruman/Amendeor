import type { Rule, ProposalDraft } from './index.ts';
import { sameStem } from '../text/names.ts';
import { words } from '../text/segment.ts';

function editDistanceOne(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let left = 0; let right = 0; let edits = 0;
  while (left < a.length && right < b.length) {
    if (a[left] === b[right]) { left++; right++; continue; }
    if (++edits > 1) return false;
    if (a.length >= b.length) left++;
    if (b.length >= a.length) right++;
  }
  return edits + Number(left < a.length || right < b.length) === 1;
}

// Два имени, отличающиеся одной буквой, — чаще два разных человека (Mark и Mary, John и Joan), чем опечатка.
// Частота и сходство написаний — повод показать пару автору, но не основание менять имя: такая находка semantic,
// текст не меняется без явного решения. Заменить имя правило предлагает обычной правкой только по канону автора
// (editorial_profile.canonical_names); вариант, приписанный канону дважды, неоднозначен — снова только находка.
export const nameVariant: Rule = {
  id: 'terminology.name-variant', version: '4', langs: ['en', 'ru'], category: 'terminology', impact: 'prose', authority: 'semantic',
  detect(scene, ctx): ProposalDraft[] {
    const drafts: ProposalDraft[] = [];
    const canon = ctx.config.editorial_profile?.canonical_names ?? [];
    const canonical = new Set(canon.map((entry) => entry.name));
    const authorized = new Map<string, string[]>();
    for (const entry of canon) for (const variant of entry.variants) authorized.set(variant, [...(authorized.get(variant) ?? []), entry.name]);
    const names = [...ctx.names].filter(([name]) => name.length >= 4 && /^\p{L}+$/u.test(name) && !ctx.pack.stopwords.includes(name.toLocaleLowerCase()));
    for (const token of words(scene.text)) {
      const mapped = authorized.get(token.text);
      if (mapped) {
        const targets = [...new Set(mapped)];
        drafts.push(targets.length === 1
          ? { target: token.text, replacement: targets[0]!, start: token.start, reason: `The author's canonical name list marks this spelling as a variant of ${targets[0]}.`, authority: 'contextual', evidence: { basis: 'editorial_profile.canonical_names', canonical: targets[0]! } }
          : { target: token.text, replacement: targets[0]!, start: token.start, reason: `The author's canonical name list maps this spelling to several names (${targets.join(', ')}); decide which, if any.`, evidence: { basis: 'editorial_profile.canonical_names (ambiguous)', candidates: targets.join(', ') } });
        continue;
      }
      if (canonical.has(token.text)) continue;
      if (token.text.length < 4 || !/^\p{L}+$/u.test(token.text) || ctx.pack.stopwords.includes(token.lower) || !ctx.names.has(token.text)) continue;
      const candidate = names.find(([name, count]) => {
        if (name === token.text || count <= (ctx.names.get(token.text) ?? 0) || !sameStem(name, token.text) || !editDistanceOne(name.toLocaleLowerCase(), token.text.toLocaleLowerCase())) return false;
        const a = name.toLocaleLowerCase(); const b = token.lower;
        // Буква, добавленная в конце, — форма того же слова, а не опечатка: Sunday/Sundays, Fowler/Fowlers,
        // Henderson/Hendersons; в русском — падеж (Ленора/Леноры). На The Shepherd's Silence все 36 таких пар были ложными.
        if ((a.startsWith(b) || b.startsWith(a)) && Math.abs(a.length - b.length) === 1) return false;
        if (ctx.pack.language === 'ru' && a.slice(0, -1) === b.slice(0, -1)) return false;
        return true;
      });
      if (candidate) drafts.push({ target: token.text, replacement: candidate[0], start: token.start,
        reason: `Review: "${token.text}" differs by one letter from the more frequent name "${candidate[0]}". They may be two different people; the text is not changed unless you decide so.`,
        evidence: { basis: 'one-letter difference and book frequency', spelling: token.text, spelling_count: ctx.names.get(token.text) ?? 0, candidate: candidate[0], candidate_count: candidate[1] } });
    }
    return drafts;
  }
};
