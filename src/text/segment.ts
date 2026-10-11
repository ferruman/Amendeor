import type { LanguagePack } from '../lang/pack.ts';

export interface Span { text: string; start: number; end: number }
export interface WordToken extends Span { lower: string }
export interface SegmentedText { paragraphs: Span[]; sentences: Span[]; words: WordToken[] }

// Изменённая часть правки в координатах текста: общие начало и конец цели и замены не считаются изменением.
export function changedSpan(text: string, start: number, end: number, replacement: string): { start: number; end: number } {
  const target = text.slice(start, end);
  let prefix = 0, suffix = 0;
  while (prefix < target.length && prefix < replacement.length && target[prefix] === replacement[prefix]) prefix++;
  while (suffix < target.length - prefix && suffix < replacement.length - prefix && target.at(-1 - suffix) === replacement.at(-1 - suffix)) suffix++;
  return { start: start + prefix, end: end - suffix };
}
export function spansTouch(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && a.end > b.start || a.start === a.end && a.start > b.start && a.start < b.end || b.start === b.end && b.start > a.start && b.start < a.end;
}

// Вхождения защищённых форм профиля сохранения в тексте сцены.
export function protectedFormSpans(text: string, forms: string[]): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  for (const form of forms) for (let at = text.indexOf(form); at >= 0; at = text.indexOf(form, at + form.length)) spans.push({ start: at, end: at + form.length });
  return spans;
}
// Правка задевает защищённую форму, если её изменённая часть пересекает вхождение формы.
export function touchesProtectedForm(text: string, start: number, end: number, replacement: string, forms: string[]): boolean {
  if (!forms.length) return false;
  const changed = changedSpan(text, start, end, replacement);
  return protectedFormSpans(text, forms).some((span) => spansTouch(changed, span) || changed.start === changed.end && changed.start === span.start);
}

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
