import type { Book } from '../src/book.ts';
import { locate } from '../src/proposal/locate.ts';
import type { Proposal } from '../src/proposal/schema.ts';
import type { Mutation, PreserveSpan, MutationType } from './mutate.ts';

export interface Score {
  recall: Record<string, { recalled: number; total: number; rate: number }>;
  unnecessary: { count: number; scanned_words: number; rate: number; control_proposals: number; preserve_proposals: number };
  guard_recall: number | 'n/a'; semantic_regression: number | 'n/a'; precision: number | 'n/a';
  precision_by_pattern: Record<string, number | 'n/a'>;
  matched: Array<{ mutation_id: string; proposal_id: string }>;
}
function wordCount(book: Book): number { return book.chapters.reduce((sum, chapter) => sum + (chapter.text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0), 0); }
function corrected(scene: string, proposal: Proposal, mutation: Mutation): boolean {
  const location = locate(scene, proposal.target);
  if (!('ok' in location)) return false;
  const { start, end } = location;
  const span = mutation.span;
  if (start >= span.end || end <= span.start) return false;
  const beforeOutside = scene.slice(start, Math.min(end, span.start));
  const afterOutside = scene.slice(Math.max(start, span.end), end);
  if (!proposal.replacement.startsWith(beforeOutside) || !proposal.replacement.endsWith(afterOutside)) return false;
  const inner = proposal.replacement.slice(beforeOutside.length, proposal.replacement.length - afterOutside.length);
  return inner !== scene.slice(Math.max(start, span.start), Math.min(end, span.end));
}
export function scoreProposals(book: Book, proposals: Proposal[], mutations: Mutation[], controlChapter: string, preserve: PreserveSpan[], labels?: Map<string, boolean>, guard?: { rejected: number; total: number; regressions: number }): Score {
  const scenes = new Map(book.chapters.flatMap((chapter) => chapter.scenes.map((scene) => [`${chapter.slug}/${scene.id}`, scene.text] as const)));
  const matched: Score['matched'] = [];
  const recalled = new Set<string>();
  const contributing = new Set<string>();
  for (const mutation of mutations) {
    const scene = scenes.get(`${mutation.chapter}/${mutation.scene}`);
    if (!scene) continue;
    const proposal = proposals.find((item) => item.location.chapter === mutation.chapter && item.location.scene === mutation.scene && corrected(scene, item, mutation));
    if (proposal) { recalled.add(mutation.id); contributing.add(proposal.id); matched.push({ mutation_id: mutation.id, proposal_id: proposal.id }); }
  }
  const recall: Score['recall'] = {};
  for (const mutation of mutations) {
    const key = mutation.pattern_id ?? mutation.type;
    const count = recall[key] ?? { recalled: 0, total: 0, rate: 0 };
    count.total++;
    if (recalled.has(mutation.id)) count.recalled++;
    count.rate = count.recalled / count.total;
    recall[key] = count;
  }
  let control = 0; let protectedCount = 0; let unnecessary = 0;
  for (const proposal of proposals) {
    const isControl = proposal.location.chapter === controlChapter;
    const scene = scenes.get(`${proposal.location.chapter}/${proposal.location.scene}`);
    const location = scene ? locate(scene, proposal.target) : { stale: true as const };
    const isProtected = 'ok' in location && preserve.some((span) => span.chapter === proposal.location.chapter && span.scene === proposal.location.scene && location.start < span.end && location.end > span.start);
    if (isControl) control++;
    if (isProtected) protectedCount++;
    if (isControl || isProtected || !contributing.has(proposal.id)) unnecessary++;
  }
  const words = wordCount(book);
  const labelled = labels && [...labels.entries()].filter(([id]) => proposals.some((proposal) => proposal.id === id));
  const patternIds = [...new Set(proposals.flatMap((proposal) => proposal.source_findings ?? []).filter((id) => id.startsWith('formulaic.')))];
  const precisionByPattern: Score['precision_by_pattern'] = {};
  for (const patternId of patternIds) {
    const group = (labelled ?? []).filter(([id]) => proposals.some((proposal) => proposal.id === id && proposal.source_findings?.includes(patternId)));
    precisionByPattern[patternId] = group.length ? group.filter(([, useful]) => useful).length / group.length : 'n/a';
  }
  return { recall, unnecessary: { count: unnecessary, scanned_words: words, rate: words ? unnecessary / words : 0, control_proposals: control, preserve_proposals: protectedCount },
    guard_recall: guard ? guard.rejected / guard.total : 'n/a', semantic_regression: guard ? guard.regressions : 'n/a',
    precision: labelled?.length ? labelled.filter(([, useful]) => useful).length / labelled.length : 'n/a', precision_by_pattern: precisionByPattern, matched };
}
