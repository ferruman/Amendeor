import type { Book } from '../book.ts';
import type { LanguagePack } from '../lang/pack.ts';
import { sentences, words } from './segment.ts';

export function sameStem(a: string, b: string): boolean {
  const left = a.toLocaleLowerCase(); const right = b.toLocaleLowerCase();
  return left === right || (left.length === right.length && left.length > 1 && left.slice(0, -1) === right.slice(0, -1)) || (left.length >= 6 && right.length >= 6 && left.slice(0, 6) === right.slice(0, 6));
}

export function properNouns(book: Book, pack: LanguagePack): Map<string, number> {
  const counts = new Map<string, number>();
  for (const chapter of book.chapters) for (const scene of chapter.scenes) {
    const sentenceStarts = sentences(scene.text, pack).map((sentence) => words(sentence.text)[0]?.start === undefined ? -1 : sentence.start + words(sentence.text)[0]!.start);
    const firsts = new Set(sentenceStarts);
    for (const token of words(scene.text)) {
      if (firsts.has(token.start) || !/^\p{Lu}/u.test(token.text) || token.text.length < 2) continue;
      counts.set(token.text, (counts.get(token.text) ?? 0) + 1);
    }
  }
  return counts;
}
