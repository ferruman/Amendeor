import type { Proposal } from '../proposal/schema.ts';
import type { LanguagePack } from '../lang/pack.ts';

export function classifyEdit(target: string, replacement: string, pack: LanguagePack): Proposal['impact'] {
  const plain = (text: string) => text.toLocaleLowerCase(pack.language).replace(/[^\p{L}\p{N}]/gu, '');
  if (plain(target) === plain(replacement)) return 'mechanical';
  const variants = pack.spelling_variants.some(([a, b]) => plain(target) === plain(a) && plain(replacement) === plain(b) || plain(target) === plain(b) && plain(replacement) === plain(a));
  return variants ? 'mechanical' : 'prose';
}
