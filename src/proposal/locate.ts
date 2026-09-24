import { normalizeQuote } from '../hash.ts';

export interface Target { text: string; hash?: string; before?: string; after?: string; occurrence?: number }
export type LocateResult = { ok: true; start: number; end: number; moved: boolean } | { stale: true } | { ambiguous: true };

function normalizedWithOffsets(raw: string): { text: string; starts: number[]; ends: number[] } {
  const segments = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(raw)];
  let text = ''; const starts: number[] = []; const ends: number[] = [];
  let pendingSpace: { start: number; end: number } | undefined;
  for (const segment of segments) {
    const value = segment.segment.normalize('NFC');
    if (/^\s+$/u.test(value)) {
      if (!pendingSpace) pendingSpace = { start: segment.index, end: segment.index + segment.segment.length };
      else pendingSpace.end = segment.index + segment.segment.length;
      continue;
    }
    if (pendingSpace && text.length) { text += ' '; starts.push(pendingSpace.start); ends.push(pendingSpace.end); }
    pendingSpace = undefined;
    for (let index = 0; index < value.length; index++) {
      starts.push(segment.index);
      ends.push(segment.index + segment.segment.length);
    }
    text += value;
  }
  return { text: text.trimEnd(), starts, ends };
}

export function locate(sceneText: string, target: Target & { replacement?: string }): LocateResult {
  if (target.replacement !== undefined && target.replacement.split(/\n\s*\n/).filter(Boolean).length > 1) throw new Error('replacement-spans-paragraphs');
  const normalizedTarget = normalizeQuote(target.text);
  if (!normalizedTarget) return { stale: true };
  const mapped = normalizedWithOffsets(sceneText);
  const positions: Array<{ nStart: number; nEnd: number; start: number; end: number }> = [];
  let from = 0;
  while ((from = mapped.text.indexOf(normalizedTarget, from)) !== -1) {
    const last = from + normalizedTarget.length - 1;
    const start = mapped.starts[from]!;
    const end = sceneText.startsWith(target.text, start) ? start + target.text.length : mapped.ends[last]!;
    positions.push({ nStart: from, nEnd: last + 1, start, end });
    from++;
  }
  if (!positions.length) return { stale: true };
  if (positions.length === 1) return { ok: true, start: positions[0]!.start, end: positions[0]!.end, moved: hasContext(target) && !contextMatches(sceneText, positions[0]!, target) };
  const byContext = positions.filter((position) => contextMatches(sceneText, position, target));
  if (byContext.length === 1) return { ok: true, start: byContext[0]!.start, end: byContext[0]!.end, moved: false };
  const occurrence = target.occurrence;
  if (occurrence === undefined || occurrence < 0 || occurrence >= positions.length) return { ambiguous: true };
  const selected = positions[occurrence]!;
  return { ok: true, start: selected.start, end: selected.end, moved: hasContext(target) && byContext.length !== 1 };
}

function contextMatches(text: string, position: { start: number; end: number }, target: Target): boolean {
  const before = target.before ?? ''; const after = target.after ?? '';
  const normalizedBefore = normalizeQuote(before); const normalizedAfter = normalizeQuote(after);
  const actualBefore = normalizeQuote(text.slice(Math.max(0, position.start - Math.max(before.length * 2, 180)), position.start));
  const actualAfter = normalizeQuote(text.slice(position.end, position.end + Math.max(after.length * 2, 180)));
  return (!normalizedBefore || actualBefore.endsWith(normalizedBefore)) && (!normalizedAfter || actualAfter.startsWith(normalizedAfter));
}

function hasContext(target: Target): boolean { return Boolean(normalizeQuote(target.before ?? '') || normalizeQuote(target.after ?? '')); }
