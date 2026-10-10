import type { Book } from '../src/book.ts';
import { locate } from '../src/proposal/locate.ts';
import type { Proposal } from '../src/proposal/schema.ts';
import type { Mutation, PreserveSpan, MutationType } from './mutate.ts';

export interface Score {
  recall: Record<string, { recalled: number; total: number; rate: number }>;
  unnecessary: { count: number; scanned_words: number; rate: number; control_proposals: number; preserve_proposals: number };
  guard_recall: number | 'n/a'; semantic_regression: number | 'n/a'; precision: number | 'n/a';
  precision_by_pattern: Record<string, number | 'n/a'>;
  // matched: замена изменила участок мутации (обнаружение, не правильность); restored: текст после замены совпал с оригиналом.
  matched: Array<{ mutation_id: string; proposal_id: string }>;
  restored: Array<{ mutation_id: string; proposal_id: string }>;
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
function restored(scene: string, proposal: Proposal, mutation: Mutation): boolean {
  const location = locate(scene, proposal.target);
  if (!('ok' in location) || location.start > mutation.span.end || location.end < mutation.span.start) return false;
  const from = Math.min(location.start, mutation.span.start), to = Math.max(location.end, mutation.span.end);
  return scene.slice(from, location.start) + proposal.replacement + scene.slice(location.end, to) === scene.slice(from, mutation.span.start) + mutation.original + scene.slice(mutation.span.end, to);
}
export function scoreProposals(book: Book, proposals: Proposal[], mutations: Mutation[], controlChapter: string, preserve: PreserveSpan[], labels?: Map<string, boolean>, guard?: { rejected: number; total: number; regressions: number }): Score {
  const scenes = new Map(book.chapters.flatMap((chapter) => chapter.scenes.map((scene) => [`${chapter.slug}/${scene.id}`, scene.text] as const)));
  const matched: Score['matched'] = []; const exact: Score['restored'] = [];
  const recalled = new Set<string>();
  const contributing = new Set<string>();
  for (const mutation of mutations) {
    const scene = scenes.get(`${mutation.chapter}/${mutation.scene}`);
    if (!scene) continue;
    const proposal = proposals.find((item) => item.location.chapter === mutation.chapter && item.location.scene === mutation.scene && corrected(scene, item, mutation));
    if (proposal) { recalled.add(mutation.id); contributing.add(proposal.id); matched.push({ mutation_id: mutation.id, proposal_id: proposal.id }); }
    const restoring = proposals.find((item) => item.location.chapter === mutation.chapter && item.location.scene === mutation.scene && restored(scene, item, mutation));
    if (restoring) exact.push({ mutation_id: mutation.id, proposal_id: restoring.id });
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
    precision: labelled?.length ? labelled.filter(([, useful]) => useful).length / labelled.length : 'n/a', precision_by_pattern: precisionByPattern, matched, restored: exact };
}

// Оценка по политике (пост-аудит 2026-10-10). Не заменяет scoreProposals: matched/restored остаются для старых отчётов.
export type Outcome = 'exact' | 'alternative' | 'partial' | 'incorrect' | 'harmful';
export interface Judgement { target: string; replacement: string; label: 'harmful' | 'valid' | 'invalid' | 'ambiguous'; note?: string }
const rank: Record<Outcome, number> = { exact: 4, alternative: 3, partial: 2, incorrect: 1, harmful: 0 };
const tokens = (text: string) => text.match(/[\p{L}\p{N}]+/gu) ?? [];
function subsequence(small: string[], large: string[]): boolean { let at = 0; for (const word of large) if (word === small[at]) at++; return at === small.length; }

// Исход одной правки для одной мутации: null — правка не меняет участок мутации.
export function outcome(scene: string, proposal: Proposal, mutation: Mutation, judgements: Judgement[] = []): Outcome | null {
  const location = locate(scene, proposal.target);
  if (!('ok' in location) || location.start > mutation.span.end || location.end < mutation.span.start) return null;
  const from = Math.min(location.start, mutation.span.start), to = Math.max(location.end, mutation.span.end);
  const got = scene.slice(from, location.start) + proposal.replacement + scene.slice(location.end, to);
  const window = (text: string) => scene.slice(from, mutation.span.start) + text + scene.slice(mutation.span.end, to);
  if (got === window(mutation.mutated)) return null;
  const label = judgements.find((item) => item.target === proposal.target.text && item.replacement === proposal.replacement)?.label;
  if (label === 'harmful') return 'harmful';
  if (got === window(mutation.original)) return 'exact';
  if ((mutation.alternatives ?? []).some((text) => got === window(text))) return 'alternative';
  // Частичное: только удаляет часть вставленного, ничего не добавляя (подпоследовательность изменённого и надпоследовательность оригинала).
  const result = tokens(got), mutated = tokens(window(mutation.mutated)), original = tokens(window(mutation.original));
  if (result.length < mutated.length && subsequence(result, mutated) && subsequence(original, result)) return 'partial';
  return 'incorrect';
}

export interface PolicyScore {
  mutations: Array<{ id: string; type: string; policy: string[]; detected: boolean; candidate: Outcome | null; final: Outcome | null; final_source: string | null; candidate_policy_compliant: boolean; policy_compliant: boolean; harmful_candidates: number }>;
  counts: Record<'total' | 'detected' | 'exact' | 'alternative' | 'partial' | 'incorrect' | 'harmful' | 'policy_compliant' | 'reachable' | 'final_exact' | 'final_alternative' | 'final_partial' | 'final_incorrect' | 'final_harmful' | 'final_policy_compliant', number>;
  rejections: { correct: number; incorrect: number; ambiguous: number; unlabelled: number; items: Array<{ proposal_id: string; guard: string; reason: string; verdict: 'correct' | 'incorrect' | 'ambiguous' | 'unlabelled'; why: string }> };
}
// candidates — все предложения до детерминированных фильтров (правила и модель); final — принятые после фильтров и verifier.
export function scoreByPolicy(book: Book, mutations: Mutation[], candidates: Proposal[], final: Proposal[], rejected: Array<{ proposal_id: string; guard: string; reason: string }>, judgements: Judgement[] = []): PolicyScore {
  const scenes = new Map(book.chapters.flatMap((chapter) => chapter.scenes.map((scene) => [`${chapter.slug}/${scene.id}`, scene.text] as const)));
  const best = (proposals: Proposal[], mutation: Mutation) => {
    const scene = scenes.get(`${mutation.chapter}/${mutation.scene}`)!;
    let top: { outcome: Outcome; proposal: Proposal } | null = null;
    for (const proposal of proposals.filter((item) => item.location.chapter === mutation.chapter && item.location.scene === mutation.scene)) {
      const result = outcome(scene, proposal, mutation, judgements);
      if (result && (!top || rank[result] > rank[top.outcome])) top = { outcome: result, proposal };
    }
    return top;
  };
  const allowed = (proposal: Proposal, mutation: Mutation) => (mutation.policy ?? []).includes(proposal.source === 'model' ? 'model-fixable' : 'rule-fixable');
  const compliant = (proposals: Proposal[], mutation: Mutation, scene: string) => proposals.some((proposal) => proposal.location.chapter === mutation.chapter && proposal.location.scene === mutation.scene
    && ['exact', 'alternative'].includes(outcome(scene, proposal, mutation, judgements) ?? '') && allowed(proposal, mutation));
  const rows = mutations.map((mutation) => {
    const scene = scenes.get(`${mutation.chapter}/${mutation.scene}`)!;
    const candidate = best(candidates, mutation), accepted = best(final, mutation);
    const harmful = candidates.filter((proposal) => proposal.location.chapter === mutation.chapter && proposal.location.scene === mutation.scene && outcome(scene, proposal, mutation, judgements) === 'harmful').length;
    return { id: mutation.id, type: mutation.type, policy: mutation.policy ?? [], detected: Boolean(candidate), candidate: candidate?.outcome ?? null, final: accepted?.outcome ?? null, final_source: accepted?.proposal.source ?? null,
      candidate_policy_compliant: compliant(candidates, mutation, scene), policy_compliant: compliant(final, mutation, scene), harmful_candidates: harmful };
  });
  const count = (field: 'candidate' | 'final', value: Outcome) => rows.filter((row) => row[field] === value).length;
  const items: PolicyScore['rejections']['items'] = [];
  for (const item of rejected) {
    const proposal = candidates.find((candidate) => candidate.id === item.proposal_id);
    if (!proposal) continue;
    const judged = judgements.find((entry) => entry.target === proposal.target.text && entry.replacement === proposal.replacement)?.label;
    const hits = mutations.flatMap((mutation) => { const scene = scenes.get(`${mutation.chapter}/${mutation.scene}`); const result = scene && mutation.chapter === proposal.location.chapter && mutation.scene === proposal.location.scene ? outcome(scene, proposal, mutation, judgements) : null; return result ? [{ mutation, result }] : []; });
    const fixes = hits.find((hit) => ['exact', 'alternative'].includes(hit.result));
    const [verdict, why]: ['correct' | 'incorrect' | 'ambiguous' | 'unlabelled', string] =
      judged === 'harmful' || judged === 'invalid' ? ['correct', `judged ${judged}`]
      : judged === 'valid' ? ['incorrect', 'judged valid']
      : judged === 'ambiguous' ? ['ambiguous', 'judged ambiguous']
      : fixes && rows.find((row) => row.id === fixes.mutation.id)?.policy_compliant ? ['correct', `mutation fixed by another accepted proposal${item.guard === 'rule-preferred' ? ' (deterministic rule)' : ''}`]
      : fixes ? (allowed(proposal, fixes.mutation) ? ['incorrect', `${fixes.result} fix of a ${proposal.source === 'model' ? 'model' : 'rule'}-fixable mutation`] : ['correct', `fix not permitted for this source: ${(fixes.mutation.policy ?? []).join(',') || 'no policy'}`])
      : hits.some((hit) => hit.result === 'partial') ? ['ambiguous', 'partial fix']
      : hits.length ? ['correct', `${hits[0]!.result} change to a mutation`] : ['unlabelled', 'outside every mutation'];
    items.push({ proposal_id: item.proposal_id, guard: item.guard, reason: item.reason, verdict, why });
  }
  const tally = (verdict: string) => items.filter((item) => item.verdict === verdict).length;
  return { mutations: rows, counts: {
    total: rows.length, detected: rows.filter((row) => row.detected).length, reachable: mutations.filter((mutation) => (mutation.policy ?? []).some((label) => label === 'model-fixable' || label === 'rule-fixable')).length,
    exact: count('candidate', 'exact'), alternative: count('candidate', 'alternative'), partial: count('candidate', 'partial'), incorrect: count('candidate', 'incorrect'), harmful: rows.filter((row) => row.harmful_candidates > 0).length,
    policy_compliant: rows.filter((row) => row.candidate_policy_compliant).length,
    final_exact: count('final', 'exact'), final_alternative: count('final', 'alternative'), final_partial: count('final', 'partial'), final_incorrect: count('final', 'incorrect'), final_harmful: count('final', 'harmful'), final_policy_compliant: rows.filter((row) => row.policy_compliant).length
  }, rejections: { correct: tally('correct'), incorrect: tally('incorrect'), ambiguous: tally('ambiguous'), unlabelled: tally('unlabelled'), items } };
}
