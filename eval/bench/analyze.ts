// Анализ стенда Editor × Verifier: только сохранённые данные, без вызовов моделей.
// node eval/bench/analyze.ts --out <name>
import { readFile, readdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSource } from '../../src/source/index.ts';
import { loadPack } from '../../src/lang/pack.ts';
import { makeProposal } from '../../src/proposal/identity.ts';
import { locate } from '../../src/proposal/locate.ts';
import type { Proposal } from '../../src/proposal/schema.ts';
import { withPolicy, type Mutation } from '../mutate.ts';
import { outcome, scoreByPolicy, type Judgement } from '../score.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const amendeor = path.resolve(here, '../..');
const out = process.argv[process.argv.indexOf('--out') + 1]!;
const root = path.join(amendeor, 'eval/results', out);
const configsFile = process.argv.includes('--configs') ? process.argv[process.argv.indexOf('--configs') + 1]! : 'configs.json';
const bench = JSON.parse(await readFile(path.join(here, configsFile), 'utf8'));
const exists = (file: string) => stat(file).then(() => true, () => false);
const requests = (await readFile(path.join(root, 'requests.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)]! : null; };
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const round = (value: number, digits = 6) => Number(value.toFixed(digits));
const text = (row: any): string | null => row.response?.choices?.[0]?.message?.content ?? (Array.isArray(row.response?.content) ? row.response.content.filter((item: any) => item.type === 'text').map((item: any) => item.text).join('') : null);
const truncated = (row: any) => row.finish === 'length' || row.finish === 'max_tokens';
const verdictOf = (row: any) => { if (row.status !== 200 || truncated(row)) return null; try { const value = JSON.parse(text(row) ?? ''); return typeof value.preserved === 'boolean' ? (value.preserved ? 'preserved' : 'changed') : 'schema-error'; } catch { return 'json-error'; } };

// Проход = цепочка HTTP-попыток шлюза до первого полного ответа. Решение после k проходов: все k ответов «preserved».
function passesOf(calls: any[]): Array<{ verdict: string; cost: number; ms: number; attempts: number }> {
  const passes: Array<{ verdict: string; cost: number; ms: number; attempts: number }> = []; let cost = 0, ms = 0, attempts = 0;
  for (const call of calls) {
    cost += call.cost; ms += call.ms ?? 0; attempts++;
    const verdict = verdictOf(call);
    if (verdict === null && attempts < 3) continue;
    passes.push({ verdict: verdict ?? 'failed', cost, ms, attempts }); cost = 0; ms = 0; attempts = 0;
  }
  return passes;
}
const decideAt = (passes: Array<{ verdict: string }>, k: number) => passes.length >= k && passes.slice(0, k).every((pass) => pass.verdict === 'preserved') ? 'ACCEPT' : 'REJECT';
const costAt = (passes: Array<{ cost: number }>, k: number) => sum(passes.slice(0, k).map((pass) => pass.cost));

// ---------- Stage A ----------
const cases = (JSON.parse(await readFile(path.join(here, 'stage-a-cases.json'), 'utf8')) as { cases: Array<{ id: string; before: string; after: string; context: string; decision: string; severity: string | null; category: string }> }).cases;
const stageA: Record<string, any> = {};
const perCase: Record<string, Record<string, { passes: ReturnType<typeof passesOf>; row: any }>> = {};
for (const name of bench.stage_a_verifiers ?? []) {
  const file = path.join(root, 'stage-a', `${name}.json`);
  if (!await exists(file)) continue;
  const result = JSON.parse(await readFile(file, 'utf8'));
  perCase[name] = {};
  for (const row of result.rows) perCase[name][row.id] = { row, passes: passesOf(requests.filter((call) => call.stage === 'stage-a' && call.job === `${name}/${row.id}`)) };
  const metrics = (rows: any[], k: number) => {
    const decided = rows.map((row) => ({ ...row, at: decideAt(perCase[name]![row.id]!.passes, k), cost_k: costAt(perCase[name]![row.id]!.passes, k) }));
    const label = (decision: string, severity?: string) => decided.filter((row) => row.decision === decision && (!severity || row.severity === severity));
    const accepted = (rows: any[]) => rows.filter((row) => row.at === 'ACCEPT');
    return { cases: decided.length,
      harmful_accepted: accepted(label('REJECT', 'harmful')).map((row) => row.id), unnecessary_accepted: accepted(label('REJECT', 'unnecessary')).map((row) => row.id),
      valid_rejected: label('ACCEPT').filter((row) => row.at === 'REJECT').map((row) => row.id),
      correct_acceptance_rate: label('ACCEPT').length ? round(accepted(label('ACCEPT')).length / label('ACCEPT').length, 3) : null,
      correct_rejection_rate: label('REJECT').length ? round(label('REJECT').filter((row) => row.at === 'REJECT').length / label('REJECT').length, 3) : null,
      harmful_rejection_rate: label('REJECT', 'harmful').length ? round(label('REJECT', 'harmful').filter((row) => row.at === 'REJECT').length / label('REJECT', 'harmful').length, 3) : null,
      ambiguous_withheld: label('AMBIGUOUS').filter((row) => row.at === 'REJECT').map((row) => row.id), ambiguous_accepted: accepted(label('AMBIGUOUS')).map((row) => row.id),
      cost_usd: round(sum(decided.map((row) => row.cost_k))) };
  };
  const rows = result.rows.filter((row: any) => !row.self_pairing);
  const calls = requests.filter((call) => call.stage === 'stage-a' && call.job.startsWith(`${name}/`));
  stageA[name] = { model: result.model, effort: result.effort, self_pairing_excluded: result.rows.filter((row: any) => row.self_pairing).map((row: any) => row.id),
    all_cases: { pass3: metrics(rows, 3), pass2: metrics(rows, 2), pass1: metrics(rows, 1) },
    reaching_verifier: { note: 'only cases the deterministic guards pass in production', pass3: metrics(rows.filter((row: any) => row.deterministic === 'passes'), 3), pass1: metrics(rows.filter((row: any) => row.deterministic === 'passes'), 1) },
    json_schema_failures: calls.filter((call) => ['json-error', 'schema-error'].includes(verdictOf(call) ?? '')).length, truncated_responses: calls.filter(truncated).length, http_errors: calls.filter((call) => call.status !== 200).length,
    verify_failed_cases: result.rows.filter((row: any) => row.verify_failed).map((row: any) => row.id),
    split_verdicts: result.rows.filter((row: any) => new Set(perCase[name]![row.id]!.passes.map((pass) => pass.verdict)).size > 1).map((row: any) => row.id),
    requests: calls.length, tokens_in: sum(calls.map((call) => call.usage?.prompt_tokens ?? call.usage?.input_tokens ?? 0)), tokens_out: sum(calls.map((call) => call.usage?.completion_tokens ?? call.usage?.output_tokens ?? 0)),
    reasoning_tokens: sum(calls.map((call) => call.usage?.completion_tokens_details?.reasoning_tokens ?? 0)), cost_usd: round(sum(calls.map((call) => call.cost))),
    median_case_ms: median(result.rows.map((row: any) => row.ms)), median_request_ms: median(calls.map((call) => call.ms)), cost_sources: [...new Set(calls.map((call) => call.cost_source))] };
}

// Эскалация на Sonnet (симуляция на одних и тех же правках Stage A). Триггеры — явные, по правке и по ответам первичного verifier.
const tokens = (value: string) => value.match(/[\p{L}\p{N}]+/gu) ?? [];
function riskTriggers(item: (typeof cases)[number], primary: { passes: ReturnType<typeof passesOf>; row: any }): string[] {
  const triggers: string[] = [];
  if (primary.row.verify_failed || primary.passes.some((pass) => !['preserved', 'changed'].includes(pass.verdict))) triggers.push('verification-failure');
  if (new Set(primary.passes.map((pass) => pass.verdict)).size > 1) triggers.push('split-verdicts');
  const caps = (value: string) => tokens(value).filter((word) => /^\p{Lu}/u.test(word)).join(' ');
  if (caps(item.before) !== caps(item.after)) triggers.push('capitalized-word-change');
  if (/[“”«»"]|(^|\n)\s*[—–-]\s/u.test(item.before + item.after)) triggers.push('dialogue');
  const before = tokens(item.before.toLowerCase()), after = tokens(item.after.toLowerCase());
  if (after.some((word) => !before.includes(word))) triggers.push('new-word');
  const kept = before.filter((word) => after.includes(word));
  if (kept.join(' ') !== after.filter((word) => before.includes(word)).join(' ')) triggers.push('word-order');
  return triggers;
}
const escalation: Record<string, any> = {};
for (const primaryName of ['haiku', 'haiku-medium']) {
  if (!perCase[primaryName] || !perCase.sonnet) continue;
  const rows = cases.filter((item) => !perCase[primaryName]![item.id]!.row.self_pairing && !perCase.sonnet![item.id]!.row.self_pairing);
  const simulate = (mode: 'risky-accepts' | 'risky-accepts-and-rejects') => {
    const decided = rows.map((item) => {
      const primary = perCase[primaryName]![item.id]!; const sonnet = perCase.sonnet![item.id]!;
      const first = decideAt(primary.passes, 3), triggers = riskTriggers(item, primary);
      const escalate = triggers.length > 0 && (first === 'ACCEPT' || mode === 'risky-accepts-and-rejects');
      return { id: item.id, decision: item.decision, severity: item.severity, first, triggers, escalated: escalate, final: escalate ? decideAt(sonnet.passes, 3) : first, cost: costAt(primary.passes, 3) + (escalate ? costAt(sonnet.passes, 3) : 0) };
    });
    return { escalated_share: round(decided.filter((row) => row.escalated).length / decided.length, 3), escalated: decided.filter((row) => row.escalated).map((row) => `${row.id} [${row.triggers.join(',')}]`),
      harmful_accepted: decided.filter((row) => row.severity === 'harmful' && row.final === 'ACCEPT').map((row) => row.id),
      harmful_caught_by_escalation: decided.filter((row) => row.severity === 'harmful' && row.first === 'ACCEPT' && row.final === 'REJECT').map((row) => row.id),
      valid_rejected: decided.filter((row) => row.decision === 'ACCEPT' && row.final === 'REJECT').map((row) => row.id),
      valid_rejected_by_escalation: decided.filter((row) => row.decision === 'ACCEPT' && row.first === 'ACCEPT' && row.final === 'REJECT').map((row) => row.id),
      unnecessary_accepted: decided.filter((row) => row.severity === 'unnecessary' && row.final === 'ACCEPT').map((row) => row.id),
      cost_usd: round(sum(decided.map((row) => row.cost))), always_sonnet_cost_usd: round(sum(rows.map((item) => costAt(perCase.sonnet![item.id]!.passes, 3)))), primary_only_cost_usd: round(sum(rows.map((item) => costAt(perCase[primaryName]![item.id]!.passes, 3)))) };
  };
  escalation[`${primaryName}→sonnet`] = { cases: rows.length, risky_accepts: simulate('risky-accepts'), risky_accepts_and_rejects: simulate('risky-accepts-and-rejects') };
}

// ---------- Stage B ----------
const judgements = (JSON.parse(await readFile(path.join(amendeor, 'eval/labels/edit-judgements-2026-10-10.json'), 'utf8')) as { judgements: Judgement[] }).judgements;
const extra = await readFile(path.join(root, 'labels-stage-b.json'), 'utf8').then((body) => (JSON.parse(body) as { judgements: Judgement[] }).judgements, () => [] as Judgement[]);
const allJudgements = [...judgements, ...extra];
const books: Record<string, { book: any; mutations: Mutation[]; words: number; scenes: number; control: string }> = {};
// Произведения — по каталогу корпуса (v3, пилот или чистая фикстура).
for (const work of (await readdir(path.join(root, 'corpus'))).sort()) {
  const source = await openSource(path.join(root, 'corpus', work));
  const pack = (await loadPack(source.book.lang)).pack;
  const meta = JSON.parse(await readFile(path.join(root, 'corpus', work, 'mutations.json'), 'utf8'));
  books[work] = { book: source.book, mutations: withPolicy(source.book, meta.mutations, pack, 'copy'), words: sum(source.book.chapters.map((chapter) => (chapter.text.match(/[\p{L}\p{N}]+/gu) ?? []).length)), scenes: sum(source.book.chapters.map((chapter) => chapter.scenes.length)), control: meta.control_chapter };
}
const stageB: any[] = []; const unlabelled: any[] = [];
for (const config of bench.stage_b) {
  const dir = path.join(root, 'stage-b', config.id);
  const jobs: any[] = [];
  for (const name of (await readdir(dir).catch(() => [] as string[])).sort()) if (await exists(path.join(dir, name, 'result.json'))) jobs.push(JSON.parse(await readFile(path.join(dir, name, 'result.json'), 'utf8')));
  if (!jobs.length) { stageB.push({ config: config.id, tier: config.tier, tested: false }); continue; }
  const byMutation: Record<string, { policy: string; fixed: number; offered_by: Record<string, number>; candidate_fixed: number }> = {};
  const totals: Record<string, number> = {}; const add = (name: string, value: number) => { totals[name] = (totals[name] ?? 0) + value; };
  const passStudy = { k1: { harmful_more_accepted: [] as string[], valid_more_accepted: [] as string[], unknown_more_accepted: [] as string[], cost: 0 }, k2: { harmful_more_accepted: [] as string[], valid_more_accepted: [] as string[], unknown_more_accepted: [] as string[], cost: 0 }, k3: { cost: 0 } };
  const finals: string[] = []; const harmfulFinal: string[] = []; const verifierRejections = { valid: [] as string[], harmful_or_incorrect: [] as string[], unknown: [] as string[], verify_failed: 0 };
  for (const job of jobs) {
    const set = books[job.work]!;
    const sceneText = (chapter: string, scene: string) => set.book.chapters.find((item: any) => item.slug === chapter).scenes.find((item: any) => item.id === scene).text;
    // Находки на проверку (semantic, unverified) текст не меняют: это не итоговые правки, они считаются отдельно.
    const final: Proposal[] = job.proposals.filter((proposal: Proposal) => !proposal.unverified);
    const rejected = job.rejections.filter((item: any) => item.chapter && item.scene !== '@title').map((item: any) => ({ ...makeProposal({ chapter: item.chapter, scene: item.scene, category: item.category, target: item.target, replacement: item.replacement, occurrence: item.occurrence, sceneText: sceneText(item.chapter, item.scene), source: item.source }), id: item.proposal_id }));
    const score = scoreByPolicy(set.book, set.mutations, [...final, ...rejected], final, job.rejections, allJudgements);
    for (const [name, value] of Object.entries(score.counts)) add(name, value);
    for (const row of score.mutations) { const key = `${job.work}:${row.type}`; byMutation[key] ??= { policy: row.policy.join('+'), fixed: 0, offered_by: {} as Record<string, number>, candidate_fixed: 0 }; if (row.policy_compliant) { byMutation[key].fixed++; byMutation[key].offered_by[row.final_source ?? '?'] = (byMutation[key].offered_by[row.final_source ?? '?'] ?? 0) + 1; } if (row.candidate_policy_compliant) byMutation[key].candidate_fixed++; }
    // Предложения в финале, не исправляющие ни одной мутации: лишние (если не помечены иначе) — по источнику.
    const touches = (proposal: Proposal) => set.mutations.some((mutation) => mutation.chapter === proposal.location.chapter && mutation.scene === proposal.location.scene && outcome(sceneText(mutation.chapter, mutation.scene), proposal, mutation, allJudgements) !== null);
    for (const proposal of final) {
      const key = `${proposal.target.text} → ${proposal.replacement}`;
      const judged = allJudgements.find((item) => item.target === proposal.target.text && item.replacement === proposal.replacement)?.label;
      if (judged === 'harmful') harmfulFinal.push(`${job.work}-${job.repeat}: ${key} [${proposal.source}]`);
      if (!touches(proposal)) {
        add(proposal.source === 'model' ? 'unnecessary_model' : 'unnecessary_rule', 1);
        if (proposal.location.chapter === set.control) add('control_edits', 1);
        if (!judged) unlabelled.push({ config: config.id, work: job.work, source: proposal.source, chapter: proposal.location.chapter, target: proposal.target.text, replacement: proposal.replacement, reason: proposal.reason });
        else add(`unnecessary_judged_${judged}`, 1);
      }
      finals.push(`${job.work}: ${key}`);
    }
    // Отказы verifier: по исходу на мутации.
    for (const item of job.rejections.filter((entry: any) => entry.guard === 'semantic-verifier')) {
      if (String(item.reason).startsWith('verify failed')) verifierRejections.verify_failed++;
      const proposal = rejected.find((entry: Proposal) => entry.id === item.proposal_id)!;
      const results = set.mutations.map((mutation) => mutation.chapter === proposal.location.chapter && mutation.scene === proposal.location.scene ? outcome(sceneText(mutation.chapter, mutation.scene), proposal, mutation, allJudgements) : null).filter(Boolean);
      const judged = allJudgements.find((entry) => entry.target === item.target && entry.replacement === item.replacement)?.label;
      const label = `${job.work}-${job.repeat}: ${item.target} → ${item.replacement}`;
      if (results.some((result) => result === 'exact' || result === 'alternative') || judged === 'valid') verifierRejections.valid.push(label);
      else if (results.some((result) => result === 'harmful' || result === 'incorrect') || judged === 'harmful' || judged === 'invalid') verifierRejections.harmful_or_incorrect.push(label);
      else verifierRejections.unknown.push(label);
    }
    // Проходы: решения для k = 1, 2 восстановлены из трёхпроходного прогона.
    const verifierCalls = requests.filter((call) => call.stage === 'stage-b' && call.job === job.job && call.role === 'verifier');
    const byPrompt = new Map<string, any[]>();
    for (const call of verifierCalls) { const prompt = JSON.stringify(call.request.messages ?? call.request.system); byPrompt.set(prompt, [...(byPrompt.get(prompt) ?? []), call]); }
    for (const calls of byPrompt.values()) {
      const passes = passesOf(calls);
      const user = String(calls[0].request.messages.at(-1).content);
      const before = user.match(/BEFORE:\n\n([\s\S]*?)\n\nAFTER:/)?.[1] ?? '', after = user.match(/AFTER:\n\n([\s\S]*?)\n\nSURROUNDING PARAGRAPH:/)?.[1] ?? '';
      const proposal = [...final, ...rejected].find((entry) => entry.target.text === before && entry.replacement === after);
      const klass = (() => {
        if (!proposal) return 'unknown';
        const judged = allJudgements.find((entry) => entry.target === before && entry.replacement === after)?.label;
        if (judged === 'harmful' || judged === 'invalid') return 'harmful';
        if (judged === 'valid') return 'valid';
        const results = set.mutations.map((mutation) => mutation.chapter === proposal.location.chapter && mutation.scene === proposal.location.scene ? outcome(sceneText(mutation.chapter, mutation.scene), proposal, mutation, allJudgements) : null).filter(Boolean);
        return results.some((result) => result === 'exact' || result === 'alternative') ? 'valid' : results.some((result) => result === 'harmful' || result === 'incorrect') ? 'harmful' : 'unknown';
      })();
      for (const k of [1, 2] as const) {
        if (decideAt(passes, k) === 'ACCEPT' && decideAt(passes, 3) === 'REJECT') passStudy[`k${k}`][`${klass}_more_accepted` as 'valid_more_accepted'].push(`${job.work}-${job.repeat}: ${before} → ${after}`);
        passStudy[`k${k}`].cost += costAt(passes, k);
      }
      passStudy.k3.cost += costAt(passes, 3);
    }
  }
  const calls = requests.filter((call) => call.stage === 'stage-b' && call.job.startsWith(`${config.id}/`));
  const role = (name: string) => calls.filter((call) => call.role === name);
  const cost = sum(calls.map((call) => call.cost));
  const repeats = new Set(jobs.map((job) => job.repeat)).size;
  const words = sum(jobs.map((job) => books[job.work]!.words)), scenes = sum(jobs.map((job) => books[job.work]!.scenes));
  const parserFailures = sum(jobs.map((job) => (job.stages.find((stage: any) => stage.name === 'model')?.failures ?? []).length));
  const discarded: Record<string, number> = {};
  for (const job of jobs) for (const item of job.stages.find((stage: any) => stage.name === 'model')?.discarded ?? []) discarded[item.reason] = (discarded[item.reason] ?? 0) + 1;
  const retryCalls = calls.filter((call, index) => truncated(call) || call.status !== 200 || (call.role === 'editor' && calls.slice(0, index).some((other) => other.role === 'editor' && other.job === call.job && other.request.messages?.[0]?.content === call.request.messages?.[0]?.content && JSON.stringify(other.request.messages?.[1]?.content).slice(0, 4000) === JSON.stringify(call.request.messages?.[1]?.content).slice(0, 4000))));
  const correct = totals.final_exact! + totals.final_alternative!;
  stageB.push({ config: config.id, tier: config.tier, tested: true, editor: bench.models[config.editor].id + (bench.models[config.editor].reasoning_effort ? ` (${bench.models[config.editor].reasoning_effort})` : ''), verifier: bench.models[config.verifier].id + (bench.models[config.verifier].reasoning_effort ? ` (${bench.models[config.verifier].reasoning_effort})` : ''),
    jobs: jobs.length, repeats, mutations: totals.total, reachable: totals.reachable,
    final: { exact: totals.final_exact, alternative: totals.final_alternative, partial: totals.final_partial, incorrect: totals.final_incorrect, harmful_on_mutations: totals.final_harmful, policy_compliant: totals.final_policy_compliant, remaining_injected_errors: totals.total! - correct, remaining_reachable: totals.reachable! - totals.final_policy_compliant! },
    unnecessary: { model: totals.unnecessary_model ?? 0, rule: totals.unnecessary_rule ?? 0, control_edits: totals.control_edits ?? 0, judged_harmful: totals.unnecessary_judged_harmful ?? 0, judged_invalid: totals.unnecessary_judged_invalid ?? 0, judged_valid: totals.unnecessary_judged_valid ?? 0 },
    harmful_final: harmfulFinal, verifier_rejections: { valid: verifierRejections.valid.length, harmful_or_incorrect: verifierRejections.harmful_or_incorrect.length, unknown: verifierRejections.unknown.length, verify_failed: verifierRejections.verify_failed, lists: verifierRejections },
    parser_failures: parserFailures, discarded,
    detection_recall: { policy_compliant_candidates: totals.policy_compliant, final_policy_compliant: totals.final_policy_compliant, reachable: totals.reachable },
    merge: { merged_identical: sum(jobs.map((job) => job.stages.find((stage: any) => stage.name === 'model')?.merged_identical ?? 0)), conflicts: sum(jobs.map((job) => job.stages.find((stage: any) => stage.name === 'model')?.merge_conflicts ?? 0)),
      candidates: { standard: sum(jobs.map((job) => job.stages.find((stage: any) => stage.name === 'model')?.pass_candidates?.standard ?? 0)), diagnostic: sum(jobs.map((job) => job.stages.find((stage: any) => stage.name === 'model')?.pass_candidates?.diagnostic ?? 0)) },
      final_provenance: Object.fromEntries(['standard', 'diagnostic', 'standard+diagnostic'].map((key) => [key, sum(jobs.map((job) => job.proposals.filter((proposal: any) => proposal.source === 'model' && (proposal.passes ?? ['standard']).join('+') === key).length))])) },
    guard_rejections: Object.fromEntries([...new Set(jobs.flatMap((job) => job.rejections.map((item: any) => item.guard)))].sort().map((guard) => [guard, sum(jobs.map((job) => job.rejections.filter((item: any) => item.guard === guard).length))])),
    model_proposals_offered: sum(jobs.map((job) => job.proposals.filter((proposal: any) => proposal.source === 'model').length)),
    review_findings: jobs.flatMap((job) => job.proposals.filter((proposal: any) => proposal.unverified).map((proposal: any) => `${job.work}-${job.repeat}: ${proposal.source} ${proposal.target.text} → ${proposal.replacement}`)),
    proven_equivalent_merges: sum(jobs.map((job) => (job.stages.find((stage: any) => stage.name === 'model')?.merges ?? []).length)),
    replay_unrecorded_requests: sum(jobs.map((job) => job.replay?.unrecorded ?? 0)),
    cost: { total_usd: round(cost), editor_usd: round(sum(role('editor').map((call) => call.cost))), verifier_usd: round(sum(role('verifier').map((call) => call.cost))), retries_usd: round(sum(retryCalls.map((call) => call.cost))), per_1000_words_usd: round(cost / words * 1000), per_correct_final_edit_usd: correct ? round(cost / correct) : null, per_scene_usd: round(cost / scenes), per_repeat_usd: round(cost / repeats),
      sources: [...new Set(calls.map((call) => call.cost_source))] },
    requests: { total: calls.length, editor: role('editor').length, verifier: role('verifier').length, truncated: calls.filter(truncated).length, http_errors: calls.filter((call) => call.status !== 200).length, retries: retryCalls.length,
      tokens_in: sum(calls.map((call) => call.usage?.prompt_tokens ?? call.usage?.input_tokens ?? 0)), tokens_out: sum(calls.map((call) => call.usage?.completion_tokens ?? call.usage?.output_tokens ?? 0)), cached_tokens: sum(calls.map((call) => call.usage?.prompt_tokens_details?.cached_tokens ?? call.usage?.cache_read_input_tokens ?? 0)) },
    latency: { median_request_ms: median(calls.map((call) => call.ms)), mean_request_ms: calls.length ? Math.round(sum(calls.map((call) => call.ms ?? 0)) / calls.length) : null, median_job_ms: median(jobs.map((job) => job.elapsed_ms)), mean_job_ms: Math.round(sum(jobs.map((job) => job.elapsed_ms)) / jobs.length) },
    by_mutation: byMutation,
    passes: { verifier_cost_usd: { k1: round(passStudy.k1.cost), k2: round(passStudy.k2.cost), k3: round(passStudy.k3.cost) }, accepted_with_1_but_not_3: passStudy.k1, accepted_with_2_but_not_3: passStudy.k2 } });
}
// Парето: дешевле или так же — и не хуже по всем: больше policy_compliant, меньше вредных в финале, меньше лишних модельных правок.
const tested = stageB.filter((row) => row.tested);
for (const row of tested) {
  const harmful = (item: any) => item.harmful_final.length + item.final.harmful_on_mutations;
  row.pareto = !tested.some((other) => other !== row && other.cost.per_repeat_usd <= row.cost.per_repeat_usd && other.final.policy_compliant / other.repeats >= row.final.policy_compliant / row.repeats && harmful(other) / other.repeats <= harmful(row) / row.repeats && other.unnecessary.model / other.repeats <= row.unnecessary.model / row.repeats
    && (other.cost.per_repeat_usd < row.cost.per_repeat_usd || other.final.policy_compliant / other.repeats > row.final.policy_compliant / row.repeats || harmful(other) / other.repeats < harmful(row) / row.repeats || other.unnecessary.model / other.repeats < row.unnecessary.model / row.repeats));
}
const corpus = Object.fromEntries(Object.entries(books).map(([work, item]) => [work, { words: item.words, scenes: item.scenes, mutations: item.mutations.length, policy: item.mutations.map((mutation) => `${mutation.type}: ${mutation.policy?.join('+')}`) }]));
await writeFile(path.join(root, 'metrics.json'), `${JSON.stringify({ generated_at: new Date().toISOString(), spent_usd: round(sum(requests.map((call) => call.cost))), requests: requests.length, corpus, stage_a: stageA, escalation, stage_b: stageB, unlabelled_final_edits: unlabelled }, null, 2)}\n`);
console.log(JSON.stringify({ spent_usd: round(sum(requests.map((call) => call.cost))), stage_a: Object.keys(stageA), stage_b_tested: tested.map((row) => row.config), unlabelled_final_edits: unlabelled.length }));
