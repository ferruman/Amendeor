import type { Book } from '../book.ts';
import type { Proposal } from '../proposal/schema.ts';
import type { Hotspot } from '../metrics/index.ts';
import type { FormulaicHit } from '../patterns/formulaic.ts';

export interface EditWindow { chapter: string; scene: string; start: number; end: number; text: string; before: string; after: string; signals: FormulaicHit[]; metrics: string[] }
export function editWindows(book: Book, mode: string, contextBudget: number, ruleProposals: Proposal[] = [], hotspots: Hotspot[] = [], formulaic: FormulaicHit[] = [], protectedSpans: Array<{ chapter: string; scene: string; start: number; end: number }> = []): EditWindow[] {
  const windows: EditWindow[] = [];
  const maxChars = Math.max(500, contextBudget * (book.lang === 'ru' ? 2.5 : 4));
  for (const chapter of book.chapters) for (const scene of chapter.scenes) {
    const paragraphs = [...scene.text.matchAll(/[^\n]+(?:\n(?!\n)[^\n]+)*/g)].filter((match) => match[0].trim()).map((match) => ({ start: match.index!, end: match.index! + match[0].length, text: match[0] }));
    let group: typeof paragraphs = []; let length = 0;
    const flush = () => {
      if (!group.length) return;
      const start = group[0]!.start, end = group.at(-1)!.end;
      const text = scene.text.slice(start, end);
      const relevant = mode !== 'mechanical' || ruleProposals.some((proposal) => proposal.location.chapter === chapter.slug && proposal.location.scene === scene.id && text.includes(proposal.target.text)) || hotspots.some((hotspot) => hotspot.chapter === chapter.slug && hotspot.scene === scene.id);
      const beforeStart = scene.text.lastIndexOf('\n\n', Math.max(0, start - 2));
      const afterEnd = scene.text.indexOf('\n\n', end + 2);
      const signals = formulaic.filter((hit) => hit.chapter === chapter.slug && hit.scene === scene.id && hit.start >= start && hit.end <= end && !protectedSpans.some((span) => span.chapter === chapter.slug && span.scene === scene.id && hit.start < span.end && hit.end > span.start));
      const metrics = hotspots.filter((hotspot) => hotspot.chapter === chapter.slug && hotspot.scene === scene.id).map((hotspot) => hotspot.metric);
      if (relevant || signals.length) windows.push({ chapter: chapter.slug, scene: scene.id, start, end, text, before: scene.text.slice(beforeStart < 0 ? 0 : beforeStart + 2, start).slice(-1200), after: scene.text.slice(end, afterEnd < 0 ? scene.text.length : afterEnd).slice(0, 1200), signals, metrics });
      group = []; length = 0;
    };
    for (const paragraph of paragraphs) {
      if (group.length && length + paragraph.text.length > maxChars) flush();
      group.push(paragraph); length += paragraph.text.length;
      if (length >= maxChars) flush();
    }
    flush();
  }
  return windows;
}
