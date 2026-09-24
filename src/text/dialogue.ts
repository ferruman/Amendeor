import type { LanguagePack } from '../lang/pack.ts';
import type { Span } from './segment.ts';

export function dialogueSpans(text: string, pack: LanguagePack): Span[] {
  const spans: Span[] = [];
  for (const [open, close] of pack.quote_pairs) {
    let start = -1;
    for (let index = 0; index < text.length; index++) {
      if (text[index] === '\\') { index++; continue; }
      if (start < 0 && text.startsWith(open, index)) { start = index; index += open.length - 1; continue; }
      if (start >= 0 && text.startsWith(close, index)) {
        const end = index + close.length;
        spans.push({ text: text.slice(start, end), start, end }); start = -1; index += close.length - 1;
      }
    }
  }
  for (const match of text.matchAll(/^\s*[—–-][ \t]+[^\r\n]+/gm)) {
    const start = match.index!; spans.push({ text: match[0], start, end: start + match[0].length });
  }
  return spans.sort((a, b) => a.start - b.start);
}

export function inDialogue(spans: Span[], start: number, end: number): boolean {
  return spans.some((span) => start >= span.start && end <= span.end);
}
