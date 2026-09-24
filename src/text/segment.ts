import type { LanguagePack } from '../lang/pack.ts';

export interface Span { text: string; start: number; end: number }
export interface WordToken extends Span { lower: string }
export interface SegmentedText { paragraphs: Span[]; sentences: Span[]; words: WordToken[] }

export function words(text: string): WordToken[] {
  const pattern = /\b\d{1,2}:\d{2}(?::\d{2})?\b|\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b|\b\d+(?:[.,]\d+)+\b|[\p{L}]+(?:['’][\p{L}]+)*|\d+/gu;
  return [...text.matchAll(pattern)].map((match) => ({ text: match[0], start: match.index!, end: match.index! + match[0].length, lower: match[0].toLocaleLowerCase() }));
}

export function paragraphs(text: string): Span[] {
  const result: Span[] = [];
  const separator = /(?:\r?\n){2,}/g;
  let start = 0;
  for (const match of text.matchAll(separator)) {
    if (match.index! > start && text.slice(start, match.index).trim()) result.push({ text: text.slice(start, match.index), start, end: match.index! });
    start = match.index! + match[0].length;
  }
  if (start < text.length && text.slice(start).trim()) result.push({ text: text.slice(start), start, end: text.length });
  return result;
}

export function sentences(text: string, pack: LanguagePack): Span[] {
  const raw = [...new Intl.Segmenter(pack.language, { granularity: 'sentence' }).segment(text)].map((part) => ({ text: part.segment, start: part.index, end: part.index + part.segment.length }));
  const result: Span[] = [];
  const abbreviations = new Set(pack.abbreviations.map((item) => item.toLocaleLowerCase()));
  for (const part of raw) {
    const previous = result.at(-1);
    if (previous && abbreviations.has(previous.text.trim().split(/\s+/).at(-1)?.toLocaleLowerCase() ?? '')) {
      previous.text += part.text; previous.end = part.end;
    } else result.push({ ...part });
  }
  return result.filter((item) => item.text.trim());
}

export function segmentText(text: string, pack: LanguagePack): SegmentedText {
  return { paragraphs: paragraphs(text), sentences: sentences(text, pack), words: words(text) };
}
