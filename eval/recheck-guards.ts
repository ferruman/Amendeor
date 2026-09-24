import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSource } from '../src/source/index.ts';
import { loadPack } from '../src/lang/pack.ts';
import { semanticTrap } from '../src/guard/traps.ts';
import { scoreProposals, type Score } from './score.ts';
import { generateMutations, type PreserveSpan } from './mutate.ts';
import type { Proposal } from '../src/proposal/schema.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
type Stage = { name: string; status?: string; offered?: number; semantic_rejected?: number; rejections?: Array<{ proposal_id: string; guard: string; reason: string }> };
type Detail = { run_id: string; stages: Stage[]; proposals: Proposal[] };
type Result = { work: string; language: string; mode: string; formulaic: boolean; generated_at: string; runs: number; mutations: number; versions: unknown[]; usage: unknown[]; summary: Record<string, unknown>; scores: Score[]; run_details: Detail[]; [key: string]: unknown };
function metric(values: number[]): { mean: number; min: number; max: number } { return { mean: values.reduce((a, b) => a + b, 0) / values.length, min: Math.min(...values), max: Math.max(...values) }; }

export async function recheckGuards(sourceFile: string, targetFile: string): Promise<void> {
  const original = JSON.parse(await readFile(sourceFile, 'utf8')) as Result;
  if (!original.run_details || original.run_details.length !== original.runs) throw new Error('source lacks complete recorded runs');
  const fixtureDir = path.join(root, 'eval/fixtures', original.work);
  const fixture = JSON.parse(await readFile(path.join(fixtureDir, 'fixture.json'), 'utf8')) as { control_chapter: string };
  const preserve = JSON.parse(await readFile(path.join(fixtureDir, 'preserve.json'), 'utf8')) as { spans: PreserveSpan[] };
  const trapCount = (JSON.parse(await readFile(path.join(fixtureDir, 'traps.json'), 'utf8')) as { traps: unknown[] }).traps.length;
  const mutations = await generateMutations(original.work, original.formulaic ? 'amendeor-v2' : 'amendeor-v1', original.formulaic);
  const book = (await openSource(path.join(fixtureDir, original.formulaic ? 'mutated-formulaic' : 'mutated'))).book;
  const pack = (await loadPack(original.language)).pack;
  const removed: Array<{ run_id: string; proposal_id: string; reason: string }> = [];
  const details = original.run_details.map((detail) => {
    const kept: Proposal[] = [];
    const stages = structuredClone(detail.stages);
    const guard = stages.find((stage) => stage.name === 'guard');
    for (const proposal of detail.proposals) {
      const reason = semanticTrap(proposal.target.text, proposal.replacement, pack, { category: proposal.category, modelGenerated: proposal.source === 'model' });
      if (!reason) { kept.push(proposal); continue; }
      removed.push({ run_id: detail.run_id, proposal_id: proposal.id, reason });
      if (guard) {
        guard.offered = (guard.offered ?? 0) - 1;
        guard.semantic_rejected = (guard.semantic_rejected ?? 0) + 1;
        guard.status = 'partial';
        (guard.rejections ??= []).push({ proposal_id: proposal.id, guard: 'semantic-trap', reason });
      }
    }
    return { ...detail, stages, proposals: kept };
  });
  const scores = details.map((detail, index) => scoreProposals(book, detail.proposals, mutations, fixture.control_chapter, preserve.spans, undefined, {
    rejected: Number(original.scores[index]?.guard_recall ?? 0) * trapCount, total: trapCount, regressions: Number(original.scores[index]?.semantic_regression ?? 0)
  }));
  const types = [...new Set(mutations.map((mutation) => mutation.pattern_id ?? mutation.type))];
  const summary = { ...original.summary,
    recall: Object.fromEntries(types.map((type) => [type, metric(scores.map((score) => score.recall[type]?.rate ?? 0))])),
    unnecessary_edit_rate: metric(scores.map((score) => score.unnecessary.rate)),
    control_proposals: metric(scores.map((score) => score.unnecessary.control_proposals)),
    guard_recall: metric(scores.map((score) => Number(score.guard_recall))),
    semantic_regression: metric(scores.map((score) => Number(score.semantic_regression))) };
  const result = { ...original, generated_at: new Date().toISOString(), source_generated_at: original.generated_at,
    guard_recheck: { source: path.basename(sourceFile), method: 'monotone deterministic trap replay on recorded real-provider proposals', removed },
    summary, scores, run_details: details };
  await writeFile(targetFile, `${JSON.stringify(result, null, 2)}\n`);
  const markdown = targetFile.replace(/\.json$/u, '.md');
  const lines = [`# ${original.work} — ${original.mode}`, '', `Runs: ${original.runs}; recorded real-provider outputs; current deterministic guard replayed from ${path.basename(sourceFile)}.`, '', '| Metric | Mean | Min–max |', '| --- | ---: | ---: |'];
  for (const [type, value] of Object.entries(summary.recall)) { const item = value as ReturnType<typeof metric>; lines.push(`| Recall ${type} | ${item.mean.toFixed(3)} | ${item.min.toFixed(3)}–${item.max.toFixed(3)} |`); }
  lines.push(`| Unnecessary edits / word | ${summary.unnecessary_edit_rate.mean.toFixed(4)} | ${summary.unnecessary_edit_rate.min.toFixed(4)}–${summary.unnecessary_edit_rate.max.toFixed(4)} |`,
    `| Control proposals | ${summary.control_proposals.mean} | ${summary.control_proposals.min}–${summary.control_proposals.max} |`,
    `| Guard recall (deterministic trap stage) | ${summary.guard_recall.mean} | ${summary.guard_recall.min}–${summary.guard_recall.max} |`,
    `| Semantic regression (trap suite) | ${summary.semantic_regression.mean} | ${summary.semantic_regression.min}–${summary.semantic_regression.max} |`, '',
    `Newly rejected proposals: ${removed.length}. Model calls, cost and latency are unchanged from the source run.`, '',
    `Cost: ${JSON.stringify(summary.cost)}; model time: ${JSON.stringify(summary.model_ms)}.`, '');
  await writeFile(markdown, lines.join('\n'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const source = process.argv[2], target = process.argv[3];
  if (!source || !target || !target.endsWith('.json')) throw new Error('usage: node eval/recheck-guards.ts SOURCE.json TARGET.json');
  await recheckGuards(source, target);
}
