import type { Proposal } from '../proposal/schema.ts';
import { sha256 } from '../hash.ts';
import { changedSpan, spansTouch } from '../text/segment.ts';

// Слияние предложений стандартного и диагностического проходов одной сцены. Две правки — одна, только если доказано:
// каждая, применённая отдельно к той же исходной сцене, даёт побайтно одинаковый текст сцены. «teh» → «the» и
// «saw teh dog» → «saw the dog» — одна правка; правки одной ошибки с разным итогом (лишний пробел, другая буква,
// другой знак) — разные. Одинаковые сливаются, происхождение объединяется, причина пишется в журнал слияний.
// Пересекающиеся разные правки из разных проходов откладываются обе: ни один проход не главнее, синтетическая правка
// не составляется. Конфликт — пересечение изменённых знаков или целей: правки применяются по целям, и пересекающиеся
// цели не собрать вместе. Внутри одного прохода поведение прежнее.
export type Pass = 'standard' | 'diagnostic';
export interface Placed { proposal: Proposal; start: number; pass: Pass }
export interface MergeConflict { proposal_ids: string[]; passes: Pass[]; edits: Array<{ target: string; replacement: string; pass: Pass[] }>; reason: string }
export interface MergeRecord { proposal_id: string; merged_ids: string[]; passes: Pass[]; targets: string[]; reason: string }
export interface MergeResult { proposals: Proposal[]; conflicts: MergeConflict[]; merges: MergeRecord[]; merged: number }

const order: Pass[] = ['standard', 'diagnostic'];
type Span = { start: number; end: number };

export function mergePasses(sceneText: string, placed: Placed[]): MergeResult {
  const groups = new Map<string, { members: Array<Placed & { change: Span; target: Span }> }>();
  for (const item of placed) {
    const end = item.start + item.proposal.target.text.length;
    const key = sha256(sceneText.slice(0, item.start) + item.proposal.replacement + sceneText.slice(end));
    const group = groups.get(key) ?? { members: [] };
    group.members.push({ ...item, change: changedSpan(sceneText, item.start, end, item.proposal.replacement), target: { start: item.start, end } });
    groups.set(key, group);
  }
  const list = [...groups.entries()].map(([key, group]) => ({ key, members: group.members, passes: order.filter((pass) => group.members.some((item) => item.pass === pass)), start: Math.min(...group.members.map((item) => item.change.start)), end: Math.max(...group.members.map((item) => item.change.end)) }));
  const touch = (a: Span, b: Span) => spansTouch(a, b) || a.start === a.end && b.start === b.end && a.start === b.start;
  const conflicted = new Set<string>(); const conflicts: MergeConflict[] = [];
  for (const [index, a] of list.entries()) for (const b of list.slice(index + 1)) {
    const passes = order.filter((pass) => a.passes.includes(pass) || b.passes.includes(pass));
    if (passes.length < 2 || !a.members.some((x) => b.members.some((y) => touch(x.change, y.change) || touch(x.target, y.target)))) continue;
    conflicted.add(a.key); conflicted.add(b.key);
    const edits = [a, b].map((group) => ({ target: representative(group.members).proposal.target.text, replacement: representative(group.members).proposal.replacement, pass: group.passes }));
    conflicts.push({ proposal_ids: [a, b].map((group) => representative(group.members).proposal.id), passes, edits, reason: 'overlapping edits from different passes produce different scene text' });
  }
  const kept = list.filter((group) => !conflicted.has(group.key)).sort((a, b) => a.start - b.start || a.end - b.end || (a.key < b.key ? -1 : 1));
  const merges: MergeRecord[] = kept.filter((group) => group.members.length > 1).map((group) => {
    const chosen = representative(group.members).proposal;
    return { proposal_id: chosen.id, merged_ids: [...new Set(group.members.map((item) => item.proposal.id))].sort(), passes: group.passes, targets: [...new Set(group.members.map((item) => item.proposal.target.text))].sort(),
      reason: 'applied independently to the same scene, the edits produce byte-identical text' };
  });
  return { proposals: kept.map((group) => ({ ...representative(group.members).proposal, passes: group.passes })), conflicts, merges, merged: placed.length - list.length };
}

// Представитель одинаковых правок: самая короткая цель, затем по тексту цели, категории и id — не зависит от порядка проходов.
function representative<T extends Placed>(members: T[]): T {
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  return [...members].sort((a, b) => a.proposal.target.text.length - b.proposal.target.text.length || compare(a.proposal.target.text, b.proposal.target.text) || compare(a.proposal.category, b.proposal.category) || compare(a.proposal.id, b.proposal.id))[0]!;
}
