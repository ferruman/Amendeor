import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSource } from '../src/source/index.ts';
import { readRun } from '../src/run/store.ts';
import { scoreProposals, type Score } from './score.ts';
import { generateMutations, type PreserveSpan } from './mutate.ts';
import { loadPack } from '../src/lang/pack.ts';
import { semanticTrap } from '../src/guard/traps.ts';

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function option(name: string, fallback?: string): string { const index = process.argv.indexOf(name); const value = process.argv[index + 1]; if (index < 0) { if (fallback !== undefined) return fallback; throw new Error(`${name} required`); } if (!value || value.startsWith('--')) throw new Error(`${name} requires value`); return value; }
function metric(values: number[]): { mean: number; min: number; max: number } { return { mean: values.reduce((a, b) => a + b, 0) / values.length, min: Math.min(...values), max: Math.max(...values) }; }

export async function runEvaluation(work: string, mode: string, runs: number, includeFormulaic = false, label = ''): Promise<{ json: string; markdown: string; scores: Score[] }> {
  if (!Number.isInteger(runs) || runs < 1) throw new Error('--runs must be a positive integer');
  if (label && !/^[a-z0-9-]+$/u.test(label)) throw new Error('--label must contain lowercase letters, digits or hyphens');
  const fixtureDir = path.join(root, 'eval/fixtures', work);
  const fixture = JSON.parse(await readFile(path.join(fixtureDir, 'fixture.json'), 'utf8')) as { control_chapter: string; language: string };
  const preserve = JSON.parse(await readFile(path.join(fixtureDir, 'preserve.json'), 'utf8')) as { spans: PreserveSpan[] };
  const mutations = await generateMutations(work, includeFormulaic ? 'amendeor-v2' : 'amendeor-v1', includeFormulaic);
  const traps = (JSON.parse(await readFile(path.join(fixtureDir, 'traps.json'), 'utf8')) as { traps: Array<{ before: string; after: string }> }).traps;
  const trapPack = (await loadPack(fixture.language)).pack;
  const trapRejected = traps.filter((trap) => semanticTrap(trap.before, trap.after, trapPack)).length;
  const mutatedDir = path.join(fixtureDir, includeFormulaic ? 'mutated-formulaic' : 'mutated');
  const scores: Score[] = []; const versions: unknown[] = []; const usage: unknown[] = [];
  const runDetails: Array<{ run_id: string; stages: unknown; proposals: unknown[] }> = [];
  for (let index = 0; index < runs; index++) {
    await exec(process.execPath, [path.join(root, 'src/cli.ts'), 'edit', mutatedDir, '--mode', mode, '--json', '--no-cache'], { cwd: root, maxBuffer: 20_000_000 });
    const source = await openSource(mutatedDir);
    const run = await readRun(source.stateDir, 'latest');
    const labelsFile = path.join(root, 'eval/labels', `${work}.jsonl`);
    let labels: Map<string, boolean> | undefined;
    try { labels = new Map((await readFile(labelsFile, 'utf8')).trim().split('\n').filter(Boolean).map((line) => { const row = JSON.parse(line) as { proposal_id: string; useful: boolean }; return [row.proposal_id, row.useful]; })); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    scores.push(scoreProposals(source.book, run.proposals, mutations, fixture.control_chapter, preserve.spans, labels, { rejected: trapRejected, total: traps.length, regressions: traps.length - trapRejected }));
    versions.push((run.run as Record<string, unknown>).metadata ?? {});
    usage.push((run.run as Record<string, unknown>).ledger ?? {});
    runDetails.push({ run_id: path.basename(run.runDir), stages: (run.run as Record<string, unknown>).stages ?? {}, proposals: run.proposals });
  }
  const types = [...new Set(mutations.map((mutation) => mutation.pattern_id ?? mutation.type))];
  const ledgers = usage as Array<{ cost?: number | null; ms?: number }>;
  const cost = ledgers.some((ledger) => ledger.cost === null) ? 'n/a' as const : metric(ledgers.map((ledger) => ledger.cost ?? 0));
  const summary = { recall: Object.fromEntries(types.map((type) => [type, metric(scores.map((score) => score.recall[type]?.rate ?? 0))])),
    unnecessary_edit_rate: metric(scores.map((score) => score.unnecessary.rate)),
    control_proposals: metric(scores.map((score) => score.unnecessary.control_proposals)),
    guard_recall: metric(scores.map((score) => typeof score.guard_recall === 'number' ? score.guard_recall : 0)),
    semantic_regression: metric(scores.map((score) => typeof score.semantic_regression === 'number' ? score.semantic_regression : 0)),
    cost, model_ms: metric(ledgers.map((ledger) => ledger.ms ?? 0)) };
  const document = { schema: 'amendeor.eval/0.1', work, language: fixture.language, mode, label, runs, generated_at: new Date().toISOString(), mutation_seed: includeFormulaic ? 'amendeor-v2' : 'amendeor-v1', mutations: mutations.length, formulaic: includeFormulaic, guard_metric_scope: 'deterministic-trap-stage-only', versions, usage, summary, scores, run_details: runDetails };
  const resultsDir = path.join(root, 'eval/results'); await mkdir(resultsDir, { recursive: true });
  const stem = `${new Date().toISOString().slice(0, 10)}-${work}-${mode}${includeFormulaic ? '-formulaic' : ''}${label ? '-' + label : ''}`;
  const json = path.join(resultsDir, `${stem}.json`); const markdown = path.join(resultsDir, `${stem}.md`);
  await writeFile(json, `${JSON.stringify(document, null, 2)}\n`);
  const lines = [`# ${work} — ${mode}`, '', `Runs: ${runs}; mutations: ${mutations.length}; seed: ${includeFormulaic ? 'amendeor-v2' : 'amendeor-v1'}${label ? '; label: ' + label : ''}`, '', '| Metric | Mean | Min–max |', '| --- | ---: | ---: |'];
  for (const [type, value] of Object.entries(summary.recall)) lines.push(`| Recall ${type} | ${value.mean.toFixed(3)} | ${value.min.toFixed(3)}–${value.max.toFixed(3)} |`);
  lines.push(`| Unnecessary edits / word | ${summary.unnecessary_edit_rate.mean.toFixed(4)} | ${summary.unnecessary_edit_rate.min.toFixed(4)}–${summary.unnecessary_edit_rate.max.toFixed(4)} |`);
  lines.push(`| Control proposals | ${summary.control_proposals.mean} | ${summary.control_proposals.min}–${summary.control_proposals.max} |`, '', `Versions and model ids: ${JSON.stringify(versions[0])}`, '', `Deterministic trap recall: ${scores[0]?.guard_recall}; traps missed by deterministic stage: ${scores[0]?.semantic_regression}; precision: ${scores[0]?.precision}`, '');
  const patternIds = [...new Set(scores.flatMap((score) => Object.keys(score.precision_by_pattern)))];
  for (const id of patternIds) lines.push(`Labelled precision ${id}: ${scores.map((score) => score.precision_by_pattern[id] ?? 'n/a').join(', ')}`);
  lines.push(`Cost: ${summary.cost === 'n/a' ? 'unpriced' : `${summary.cost.mean} (${summary.cost.min}–${summary.cost.max})`}; model time: ${summary.model_ms.mean} ms (${summary.model_ms.min}–${summary.model_ms.max})`, '');
  await writeFile(markdown, lines.join('\n'));
  return { json, markdown, scores };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runEvaluation(option('--work'), option('--mode', 'mechanical'), Number(option('--runs', '1')), process.argv.includes('--formulaic'), option('--label', ''));
  console.log(JSON.stringify({ json: result.json, markdown: result.markdown }));
}
