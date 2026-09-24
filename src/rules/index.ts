import type { Scene, Book } from '../book.ts';
import type { Config } from '../config.ts';
import type { LanguagePack } from '../lang/pack.ts';
import type { Proposal } from '../proposal/schema.ts';
import { sha256, canonicalJson } from '../hash.ts';
import { properNouns } from '../text/names.ts';
import { dialogueSpans } from '../text/dialogue.ts';
import { words, type Span } from '../text/segment.ts';
import { doubledWord } from './doubled-word.ts';
import { whitespace } from './whitespace.ts';
import { balance } from './balance.ts';
import { quotes } from './quotes.ts';
import { dashesEllipsis } from './dashes-ellipsis.ts';
import { capitalization } from './capitalization.ts';
import { markdown } from './markdown.ts';
import { spellingVariant } from './spelling-variant.ts';
import { nameVariant } from './name-variant.ts';

export interface ProposalDraft { target: string; replacement: string; start: number; reason: string; category?: Proposal['category']; impact?: Proposal['impact'] }
export interface RuleContext { book: Book; config: Config; pack: LanguagePack; names: Map<string, number>; wordCounts: Map<string, number>; dialogue: Span[] }
export interface Rule { id: string; version: string; langs: string[]; category: Proposal['category']; impact: Proposal['impact']; detect(scene: Scene, ctx: RuleContext): ProposalDraft[] }
export const rules: Rule[] = [doubledWord, whitespace, balance, quotes, dashesEllipsis, capitalization, markdown, spellingVariant, nameVariant];
export const ruleSetVersion = sha256(canonicalJson(rules.map(({ id, version }) => ({ id, version }))));

export function enabledRules(config: Config, language: string): Rule[] {
  const base = language.toLowerCase().split('-')[0]!;
  return rules.filter((rule) => rule.langs.includes(base) && config.rules[rule.id] !== 'off' && config.rules[rule.id] !== false);
}

export function bookWordCounts(book: Book): Map<string, number> {
  const counts = new Map<string, number>();
  for (const chapter of book.chapters) for (const scene of chapter.scenes) for (const token of words(scene.text)) counts.set(token.lower, (counts.get(token.lower) ?? 0) + 1);
  return counts;
}

export function ruleContext(book: Book, config: Config, pack: LanguagePack, scene: Scene, names = properNouns(book, pack), wordCounts = bookWordCounts(book)): RuleContext {
  return { book, config, pack, names, wordCounts, dialogue: dialogueSpans(scene.text, pack) };
}
