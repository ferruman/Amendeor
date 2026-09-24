import type { Book } from '../book.ts';
import type { Config } from '../config.ts';
import type { LanguagePack } from '../lang/pack.ts';
import type { Proposal } from '../proposal/schema.ts';
import { locate } from '../proposal/locate.ts';
import { dialogueSpans, inDialogue } from '../text/dialogue.ts';
import { sentences, words } from '../text/segment.ts';

function quantile(values: number[], proportion: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) * proportion)]! : 0;
}
function sentenceAt(text: string, offset: number, pack: LanguagePack): string {
  return sentences(text, pack).find((sentence) => offset >= sentence.start && offset <= sentence.end)?.text ?? text;
}
function punctuation(text: string): number { return (text.match(/[;:—–…!?]/gu) ?? []).length; }
function register(text: string, pack: LanguagePack): number {
  const marks = new Set([...pack.register.formal, ...pack.register.informal].map((word) => word.toLocaleLowerCase(pack.language)));
  return words(text).filter((word) => marks.has(word.lower)).length;
}
export function voiceGuard(proposal: Proposal, sceneText: string, book: Book, pack: LanguagePack, config: Config): string | null {
  const located = locate(sceneText, proposal.target);
  if (!('ok' in located)) return 'target-stale';
  const dialogue = inDialogue(dialogueSpans(sceneText, pack), located.start, located.end);
  const normalized = Object.values(config.normalize).some((value) => value === true || typeof value === 'string' && value.length > 0 && value !== 'keep');
  if (dialogue && !normalized && proposal.category !== 'dialogue-mechanics' && ['grammar', 'word-choice', 'clarity', 'sentence-structure', 'redundancy', 'repetition', 'prose-pattern'].includes(proposal.category)) return 'dialogue-register-preserved';
  if (config.preserve.includes('sentence-fragments') && /[.!?…]\s+\p{L}/u.test(proposal.target.text) && !/[.!?…]\s+\p{L}/u.test(proposal.replacement)) return 'sentence-fragment-preserved';
  if (dialogue && !normalized && (config.preserve.includes('dialect') || config.preserve.includes('informal-dialogue')) && words(proposal.target.text).map((word) => word.lower).join(' ') !== words(proposal.replacement).map((word) => word.lower).join(' ')) return 'dialogue-language-preserved';
  const originalSentence = sentenceAt(sceneText, located.start, pack);
  const updatedScene = sceneText.slice(0, located.start) + proposal.replacement + sceneText.slice(located.end);
  const editedSentence = sentenceAt(updatedScene, located.start, pack);
  const lengths = book.chapters.flatMap((chapter) => chapter.scenes.flatMap((scene) => sentences(scene.text, pack).map((sentence) => words(sentence.text).length))).filter((length) => length > 0);
  if (lengths.length < 20) return null;
  const q1 = quantile(lengths, 0.25), q3 = quantile(lengths, 0.75), iqr = Math.max(1, q3 - q1);
  const originalLength = words(originalSentence).length, editedLength = words(editedSentence).length;
  if (originalLength >= q1 - iqr && originalLength <= q3 + iqr && (editedLength < Math.max(1, q1 - iqr) || editedLength > q3 + iqr)) return 'sentence-length-outlier';
  const punctLimit = quantile(book.chapters.flatMap((chapter) => chapter.scenes.flatMap((scene) => sentences(scene.text, pack).map((sentence) => punctuation(sentence.text)))), 0.75) + 1;
  if (punctuation(originalSentence) <= punctLimit && punctuation(editedSentence) > punctLimit) return 'punctuation-profile-outlier';
  if (register(editedSentence, pack) > register(originalSentence, pack) + 1) return 'register-shift';
  return null;
}
