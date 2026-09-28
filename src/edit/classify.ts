import type { Proposal } from '../proposal/schema.ts';
import type { LanguagePack } from '../lang/pack.ts';

// Правка модели механическая, только если меняет пробелы или берёт вариант написания из пакета.
// Регистр и пунктуация могут менять смысл (имя собственное, границы предложения), поэтому это prose.
export function classifyEdit(target: string, replacement: string, pack: LanguagePack): Proposal['impact'] {
  if (target.replace(/\s+/gu, ' ').trim() === replacement.replace(/\s+/gu, ' ').trim()) return 'mechanical';
  const marks = (text: string) => (text.match(/[^\p{L}\p{N}\s]/gu) ?? []).join('');
  if (marks(target) !== marks(replacement)) return 'prose';
  const plain = (text: string) => text.toLocaleLowerCase(pack.language).replace(/[^\p{L}\p{N}]/gu, '');
  const variants = pack.spelling_variants.some(([a, b]) => plain(target) === plain(a) && plain(replacement) === plain(b) || plain(target) === plain(b) && plain(replacement) === plain(a));
  return variants ? 'mechanical' : 'prose';
}
