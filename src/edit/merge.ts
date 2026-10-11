import type { Proposal } from '../proposal/schema.ts';
import { changedSpan, spansTouch } from '../text/segment.ts';

// Слияние предложений стандартного и диагностического проходов одной сцены. Сравнивается фактическое изменение
// (изменённые знаки сцены + вставляемый текст), а не цель целиком: «teh» → «the» и «saw teh dog» → «saw the dog» — одна правка.
// Одинаковые изменения сливаются, происхождение объединяется. Пересекающиеся разные изменения из разных проходов
// откладываются оба: ни один проход не главнее, синтетическая правка не составляется. Конфликт — пересечение целей:
// правки применяются по целям, и пересекающиеся цели не собрать вместе. Внутри одного прохода поведение прежнее.
export type Pass = 'standard' | 'diagnostic';
export interface Placed { proposal: Proposal; start: number; pass: Pass }
export interface MergeConflict { proposal_ids: string[]; passes: Pass[]; edits: Array<{ target: string; replacement: string; pass: Pass[] }>; reason: string }
export interface MergeResult { proposals: Proposal[]; conflicts: MergeConflict[]; merged: number }

const order: Pass[] = ['standard', 'diagnostic'];
export function mergePasses(sceneText: string, placed: Placed[]): MergeResult {
  const groups = new Map<string, { change: { start: number; end: number }; members: Placed[] }>();
  for (const item of placed) {
    const end = item.start + item.proposal.target.text.length;
    const change = changedSpan(sceneText, item.start, end, item.proposal.replacement);
    const inserted = item.proposal.replacement.slice(change.start - item.start, item.proposal.replacement.length - (end - change.end));
    const key = `${change.start}:${change.end}:${inserted}`;
    const group = groups.get(key) ?? { change, members: [] };
    group.members.push(item);
    groups.set(key, group);
  }
  const list = [...groups.entries()].map(([key, group]) => ({ key, ...group, passes: order.filter((pass) => group.members.some((item) => item.pass === pass)) }));
  const touch = (a: { start: number; end: number }, b: { start: number; end: number }) => spansTouch(a, b) || a.start === a.end && b.start === b.end && a.start === b.start;
  const conflicted = new Set<string>(); const conflicts: MergeConflict[] = [];
  const targets = (group: (typeof list)[number]) => group.members.map((item) => ({ start: item.start, end: item.start + item.proposal.target.text.length }));
  for (const [index, a] of list.entries()) for (const b of list.slice(index + 1)) {
    const passes = order.filter((pass) => a.passes.includes(pass) || b.passes.includes(pass));
    if (passes.length < 2 || !(touch(a.change, b.change) || targets(a).some((x) => targets(b).some((y) => touch(x, y))))) continue;
    conflicted.add(a.key); conflicted.add(b.key);
    const edits = [a, b].map((group) => ({ target: representative(group.members).proposal.target.text, replacement: representative(group.members).proposal.replacement, pass: group.passes }));
    conflicts.push({ proposal_ids: [a, b].map((group) => representative(group.members).proposal.id), passes, edits, reason: 'overlapping different edits from different passes' });
  }
  const proposals = list.filter((group) => !conflicted.has(group.key)).sort((a, b) => a.change.start - b.change.start || a.change.end - b.change.end || (a.key < b.key ? -1 : 1))
    .map((group) => ({ ...representative(group.members).proposal, passes: group.passes }));
  return { proposals, conflicts, merged: placed.length - list.length };
}

// Представитель одинаковых правок: самая короткая цель, затем по тексту цели и категории — не зависит от порядка проходов.
function representative(members: Placed[]): Placed {
  return [...members].sort((a, b) => a.proposal.target.text.length - b.proposal.target.text.length || (a.proposal.target.text < b.proposal.target.text ? -1 : a.proposal.target.text > b.proposal.target.text ? 1 : 0) || (a.proposal.category < b.proposal.category ? -1 : 1))[0]!;
}
