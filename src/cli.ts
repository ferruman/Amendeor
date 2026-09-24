#!/usr/bin/env node
import path from 'node:path';
import { openSource } from './source/index.ts';
import { readRun } from './run/store.ts';
import { acquireLock } from './run/lock.ts';
import { acceptProposals, readAccepted, rejectProposals } from './edited/decisions.ts';
import { buildEdited } from './edited/build.ts';
import { loadConfig } from './config.ts';
import { loadPack } from './lang/pack.ts';
import { computeMetrics } from './metrics/index.ts';
import { inspectSummary, renderReport, currentDecisionStatus } from './report.ts';
import { editMechanical } from './edit/mechanical.ts';
import { diffRuns } from './diff.ts';
import { sha256, normalizeText } from './hash.ts';

type Args = { command: string; target: string; values: string[]; lang?: string; out?: string; json: boolean; impact?: string; unverified: boolean; mode: string; run?: string; noCache: boolean; resume?: string };
function parseArgs(argv: string[]): Args {
  const command = argv[0] ?? ''; const target = argv[1] ?? '';
  if (!['inspect', 'edit', 'report', 'diff', 'accept', 'reject', 'build'].includes(command) || !target) throw new Error('usage: amendeor <inspect|edit|report|diff|accept|reject|build> <target> [options]');
  const result: Args = { command, target, values: [], json: false, unverified: false, mode: 'mechanical', noCache: false };
  for (let index = 2; index < argv.length; index++) {
    const item = argv[index]!;
    if (item === '--json') result.json = true;
    else if (item === '--unverified') result.unverified = true;
    else if (item === '--no-cache') result.noCache = true;
    else if (['--lang', '--out', '--impact', '--mode', '--run', '--resume'].includes(item)) {
      const value = argv[++index]; if (!value) throw new Error(`${item} requires a value`);
      if (item === '--lang') result.lang = value;
      if (item === '--out') result.out = value;
      if (item === '--impact') result.impact = value;
      if (item === '--mode') result.mode = value;
      if (item === '--run') result.run = value;
      if (item === '--resume') result.resume = value;
    } else if (item.startsWith('-')) throw new Error(`unknown option: ${item}`);
    else result.values.push(item);
  }
  if (command === 'accept' && result.impact && result.impact !== 'mechanical') throw new Error('--impact supports only mechanical');
  if (command === 'edit' && !['mechanical', 'copy', 'full'].includes(result.mode)) throw new Error(`unknown edit mode: ${result.mode}`);
  return result;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const preliminaryConfig = await loadConfig({ cli: args.lang ? { language: args.lang } : undefined });
  const source = await openSource(args.target, { lang: args.lang ?? preliminaryConfig.config.language, out: args.out });
  if (source.manuscriptDir && path.resolve(source.manuscriptDir) === path.resolve(source.editedDir)) {
    throw new Error('edited/ is a read-only input; run accept, reject, or build against the workspace or manuscript/');
  }
  const loadedConfig = source.workspaceDir ? await loadConfig({ workspaceDir: source.workspaceDir, cli: args.lang ? { language: args.lang } : undefined }) : preliminaryConfig;
  loadedConfig.config.language = source.book.lang;
  if (args.command === 'inspect' || args.command === 'edit') {
    const pack = await loadPack(source.book.lang, source.book.chapters.map((chapter) => chapter.text).join('\n'));
    if (pack.warning) process.stderr.write(`warning: ${pack.warning}\n`);
    if (args.command === 'inspect') {
      const summary = inspectSummary(source.book, pack, computeMetrics(source.book, pack.pack), source.warnings);
      print({ command: 'inspect', ...summary }, args.json); return;
    }
    if (args.mode !== 'mechanical' && !loadedConfig.config.profiles.edit) throw new Error('copy/full mode requires profiles.edit');
    if (args.resume) {
      const previous = (await readRun(source.stateDir, args.resume)).run as { metadata?: { mode?: string }; inputs?: { files?: Array<{ path: string; content_hash: string }> } };
      if (previous.metadata?.mode !== args.mode) throw new Error('resume mode differs from the existing run');
      const current = source.book.chapters.map((chapter) => ({ path: chapter.file, content_hash: sha256(normalizeText(chapter.text)) }));
      if (JSON.stringify(previous.inputs?.files) !== JSON.stringify(current)) throw new Error('resume input differs from the existing run');
    }
    const release = await acquireLock(source.stateDir);
    try {
      const result = await editMechanical(source, loadedConfig, pack, { noCache: args.noCache, runId: args.resume, mode: args.mode });
      print({ command: 'edit', mode: args.mode, run_id: result.run_id, proposals: result.proposals.length, summary: result.run.summary, stages: result.run.stages, message: loadedConfig.config.profiles.edit ? 'rules + model' : 'rules only' }, args.json);
    } finally { await release(); }
    return;
  }
  if (args.command === 'report') {
    const run = await readRun(source.stateDir, args.run ?? 'latest');
    const view = { ...(run.run as Record<string, unknown>), decisions: await currentDecisionStatus(source) };
    if (args.json) print({ command: 'report', run: view, proposals: run.proposals }, true);
    else process.stdout.write(renderReport(view));
    return;
  }
  if (args.command === 'diff') { print({ command: 'diff', ...(await diffRuns(source)) }, args.json); return; }
  const release = await acquireLock(source.stateDir);
  try {
    let summary: unknown;
    if (args.command === 'build') {
      const accepted = await readAccepted(source.editedDir);
      const results = await buildEdited({ book: source.book, editedDir: source.editedDir, accepted, manifestText: source.manifestText });
      summary = { command: 'build', results, warnings: source.warnings };
      print(summary, args.json);
      if (results.some((item) => item.status === 'stale' || item.status === 'conflict')) process.exitCode = 2;
    } else {
      const run = await readRun(source.stateDir, 'latest');
      const selected = args.command === 'accept'
        ? run.proposals.filter((proposal) => args.values.includes(proposal.id) || (args.impact === 'mechanical' && proposal.impact === 'mechanical'))
        : run.proposals.filter((proposal) => args.values.includes(proposal.id));
      if (!selected.length) throw new Error('no matching proposals in the latest run');
      if (args.command === 'accept') {
        const accepted = await acceptProposals(source.editedDir, selected, { allowUnverified: args.unverified });
        const results = await buildEdited({ book: source.book, editedDir: source.editedDir, accepted, manifestText: source.manifestText });
        summary = { command: 'accept', accepted: selected.map((proposal) => proposal.id), results };
        if (results.some((item) => item.status === 'stale' || item.status === 'conflict')) process.exitCode = 2;
      } else {
        await rejectProposals(source.stateDir, selected);
        summary = { command: 'reject', rejected: selected.map((proposal) => proposal.id) };
      }
      print(summary, args.json);
    }
  } finally { await release(); }
}

function print(value: unknown, asJson: boolean): void {
  if (asJson) { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); return; }
  const result = value as { command: string; accepted?: string[]; rejected?: string[]; results?: Array<{ id: string; status: string; detail?: string }>; warnings?: string[]; chapters?: number; scenes?: number; words?: number; language?: string; hotspots?: unknown[]; formulaic?: Array<{ id: string; chapter: string; scene: string; quote: string }>; run_id?: string; proposals?: number; message?: string; changes?: Array<{ id: string; state: string }> };
  if (result.command === 'inspect') {
    process.stdout.write(`inspect: ${result.chapters} chapters, ${result.scenes} scenes, ${result.words} words, ${result.language}; ${result.hotspots?.length ?? 0} hotspots; ${result.formulaic?.length ?? 0} formulaic passages\n`);
    for (const hit of result.formulaic ?? []) process.stdout.write(`  ${hit.chapter}/${hit.scene} ${hit.id}: ${hit.quote}\n`);
    return;
  }
  if (result.command === 'edit') { process.stdout.write(`edit: ${result.proposals} proposals, run ${result.run_id} (${result.message})\n`); return; }
  if (result.command === 'diff') { for (const change of result.changes ?? []) process.stdout.write(`${change.state} ${change.id}\n`); return; }
  process.stdout.write(`${result.command}: ${[...(result.accepted ?? []), ...(result.rejected ?? [])].join(', ') || `${result.results?.length ?? 0} edit(s)`}\n`);
  for (const item of result.results ?? []) process.stdout.write(`  ${item.status} ${item.id}${item.detail ? ` — ${item.detail}` : ''}\n`);
  for (const warning of result.warnings ?? []) process.stdout.write(`  warning: ${warning}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
