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

export const nameVariant: Rule = {
  id: 'terminology.name-variant', version: '2', langs: ['en', 'ru'], category: 'terminology', impact: 'prose',
  detect(scene, ctx): ProposalDraft[] {
    const drafts: ProposalDraft[] = [];
    const names = [...ctx.names].filter(([name]) => name.length >= 4 && /^\p{L}+$/u.test(name) && !ctx.pack.stopwords.includes(name.toLocaleLowerCase()));
    for (const token of words(scene.text)) {
      if (token.text.length < 4 || !/^\p{L}+$/u.test(token.text) || ctx.pack.stopwords.includes(token.lower) || !ctx.names.has(token.text)) continue;
      const candidate = names.find(([name, count]) => {
        if (name === token.text || count <= (ctx.names.get(token.text) ?? 0) || !sameStem(name, token.text) || !editDistanceOne(name.toLocaleLowerCase(), token.text.toLocaleLowerCase())) return false;
        if (ctx.pack.language === 'ru') {
          const a = name.toLocaleLowerCase(); const b = token.lower;
          if (a.slice(0, -1) === b.slice(0, -1)) return false;
          if ((a.startsWith(b) || b.startsWith(a)) && Math.abs(a.length - b.length) === 1) return false;
        }
        return true;
      });
      if (candidate) drafts.push({ target: token.text, replacement: candidate[0], start: token.start, reason: 'This name differs by one letter from a more frequent form; review both characters.' });
    }
    return drafts;
  }
};
