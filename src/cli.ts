#!/usr/bin/env node
import path from 'node:path';
import { openSource } from './source/index.ts';
import { readRun } from './run/store.ts';
import { acquireLock } from './run/lock.ts';
import { acceptProposals, conflictsWithAccepted, readAccepted, rejectProposals } from './edited/decisions.ts';
import { buildEdited, validateEditedPaths } from './edited/build.ts';
import { acceptAuthorized, authorizeAcceptance, cliActor, delegationHash, journal, requireDelegation } from './edited/authority.ts';
import { meter, type Meter } from './provider/meter.ts';
import { loadConfig } from './config.ts';
import { loadPack } from './lang/pack.ts';
import { computeMetrics } from './metrics/index.ts';
import { inspectSummary, renderReport, currentDecisionStatus } from './report.ts';
import { editMechanical } from './edit/mechanical.ts';
import { diffRuns } from './diff.ts';
import { sha256, normalizeText } from './hash.ts';
import { writeFindingsRun } from './checks/findings.ts';
import { checkGuide, type Guide } from './checks/guide.ts';
import { noraGal } from './checks/nora-gal.ts';
import { infostyle } from './checks/infostyle.ts';
import { checkGuideContextual } from './checks/guide-context.ts';

const guides: Record<string, Guide> = { 'nora-gal': noraGal, infostyle };

type Args = { command: string; target: string; values: string[]; lang?: string; out?: string; json: boolean; impact?: string; unverified: boolean; mode: string; run?: string; noCache: boolean; resume?: string; guide?: string; rulesOnly: boolean; delegation?: string; findings: boolean };
function parseArgs(argv: string[]): Args {
  const command = argv[0] ?? ''; const target = argv[1] ?? '';
  if (!['inspect', 'check', 'edit', 'report', 'diff', 'accept', 'reject', 'build'].includes(command) || !target) throw new Error('usage: amendeor <inspect|check|edit|report|diff|accept|reject|build> <target> [options] | amendeor serve [workspace...] [--port N] [--library DIR]');
  const result: Args = { command, target, values: [], json: false, unverified: false, mode: 'mechanical', noCache: false, rulesOnly: false, findings: false };
  for (let index = 2; index < argv.length; index++) {
    const item = argv[index]!;
    if (item === '--json') result.json = true;
    else if (item === '--unverified') result.unverified = true;
    else if (item === '--no-cache') result.noCache = true;
    else if (item === '--rules-only') result.rulesOnly = true;
    else if (item === '--findings') result.findings = true;
    else if (['--lang', '--out', '--impact', '--mode', '--run', '--resume', '--guide', '--delegation'].includes(item)) {
      const value = argv[++index]; if (!value) throw new Error(`${item} requires a value`);
      if (item === '--lang') result.lang = value;
      if (item === '--out') result.out = value;
      if (item === '--impact') result.impact = value;
      if (item === '--mode') result.mode = value;
      if (item === '--run') result.run = value;
      if (item === '--resume') result.resume = value;
      if (item === '--guide') result.guide = value;
      if (item === '--delegation') result.delegation = value;
    } else if (item.startsWith('-')) throw new Error(`unknown option: ${item}`);
    else result.values.push(item);
  }
  if (command === 'accept' && result.impact && result.impact !== 'mechanical') throw new Error('--impact supports only mechanical');
  if (command === 'edit' && !['mechanical', 'proofread', 'copy', 'full'].includes(result.mode)) throw new Error(`unknown edit mode: ${result.mode}`);
  if (result.delegation && !['accept', 'reject', 'edit', 'check'].includes(command)) throw new Error('--delegation is only valid with accept, reject, edit and check');
  if (result.delegation && result.unverified) throw new Error('--unverified is the author\'s decision, not a delegation\'s');
  if (result.guide && command !== 'check') throw new Error('--guide is only valid with check');
  if (result.rulesOnly && command !== 'check') throw new Error('--rules-only is only valid with check');
  if (result.findings && command !== 'check') throw new Error('--findings is only valid with check');
  if (command === 'check' && !(result.guide && Object.hasOwn(guides, result.guide))) throw new Error(`check requires --guide ${Object.keys(guides).join('|')}`);
  return result;
}

async function main(): Promise<void> {
  if (process.argv[2] === 'serve') { await (await import('./serve.ts')).serve(process.argv.slice(3)); return; }
  const args = parseArgs(process.argv.slice(2));
  const preliminaryConfig = await loadConfig({ cli: args.lang ? { language: args.lang } : undefined });
  const source = await openSource(args.target, { lang: args.lang ?? preliminaryConfig.config.language, out: args.out });
  if (['edit', 'accept', 'reject', 'build'].includes(args.command)) {
    if (source.manuscriptDir && path.resolve(source.manuscriptDir) === path.resolve(source.editedDir)) {
      throw new Error('edited/ is a read-only input; run accept, reject, or build against the workspace or manuscript/');
    }
    await validateEditedPaths(source.book, source.editedDir, source.manuscriptDir);
  }
  const loadedConfig = source.workspaceDir ? await loadConfig({ workspaceDir: source.workspaceDir, cli: args.lang ? { language: args.lang } : undefined }) : preliminaryConfig;
  loadedConfig.config.language = source.book.lang;
  if (args.command === 'inspect' || args.command === 'check' || args.command === 'edit') {
    const pack = await loadPack(source.book.lang, source.book.chapters.map((chapter) => chapter.text).join('\n'));
    if (pack.warning) process.stderr.write(`warning: ${pack.warning}\n`);
    if (args.command === 'inspect') {
      const summary = inspectSummary(source.book, pack, computeMetrics(source.book, pack.pack), source.warnings);
      print({ command: 'inspect', ...summary }, args.json); return;
    }
    if (args.command === 'check') {
      const startedAt = new Date().toISOString();
      const guide = guides[args.guide!]!;
      const patterns = checkGuide(guide, source.book, pack.pack);
      const contextual = args.rulesOnly ? undefined : await underDelegation(source, args.delegation, `check --guide ${guide.id}`, () => checkGuideContextual(guide, source.book, pack.pack, loadedConfig, source.stateDir, args.noCache));
      const findings = [...patterns, ...(contextual?.findings ?? [])];
      if (args.findings) {
        if (!source.findingsDir || !source.workspaceDir) throw new Error('--findings needs a Codicora workspace (codicora.yaml)');
        const written = await writeFindingsRun(source.findingsDir, source.workspaceDir, source.book, findings, { guide: guide.id, startedAt, stages: [
          { name: 'patterns', status: 'ok' },
          contextual ? { name: 'contextual', status: contextual.status, failures: contextual.failures.map((f) => ({ node_id: `${f.chapter}/${f.scene}`, reason: f.reason })) } : { name: 'contextual', status: 'skipped' }] });
        process.stderr.write(`findings/amendeor/runs/${written.runId}: ${written.count} finding(s)\n`);
      }
      print({ command: 'check', guide: guide.id, version: guide.version, count: findings.length, findings,
        contextual: contextual ? { status: contextual.status, windows: contextual.windows, checked: contextual.checked, cached: contextual.cached, failures: contextual.failures, discarded: contextual.discarded, ledger: contextual.ledger } : { status: 'skipped', reason: '--rules-only' } }, args.json);
      if (contextual?.status === 'partial') process.exitCode = 2;
      return;
    }
    if (args.mode !== 'mechanical' && !loadedConfig.config.profiles.edit) throw new Error('proofread/copy/full mode requires profiles.edit');
    if (args.resume) {
      const previous = (await readRun(source.stateDir, args.resume)).run as { metadata?: { mode?: string }; inputs?: { files?: Array<{ path: string; content_hash: string }> } };
      if (previous.metadata?.mode !== args.mode) throw new Error('resume mode differs from the existing run');
      const current = source.book.chapters.map((chapter) => ({ path: chapter.file, content_hash: sha256(normalizeText(chapter.text)), title_hash: sha256(normalizeText(chapter.title)) }));
      if (JSON.stringify(previous.inputs?.files) !== JSON.stringify(current)) throw new Error('resume input differs from the existing run');
    }
    const release = await acquireLock(source.stateDir);
    try {
      const result = await underDelegation(source, args.delegation, `edit --mode ${args.mode}`, () => editMechanical(source, loadedConfig, pack, { noCache: args.noCache, runId: args.resume, mode: args.mode, acceptAs: () => authorizeAcceptance(source.workspaceDir, cliActor(process.env, Boolean(args.delegation)), args.delegation) }));
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
      const choices = new Map(run.proposals.map((p) => [p.id, p]));
      if (args.command === 'reject') for (const r of await readAccepted(source.editedDir)) choices.set(r.proposal.id, r.proposal);
      const candidates = [...choices.values()];
      const selected = args.command === 'accept'
        ? run.proposals.filter((proposal) => args.values.includes(proposal.id) || (args.impact === 'mechanical' && proposal.impact === 'mechanical'))
        : candidates.filter((proposal) => args.values.includes(proposal.id));
      if (!selected.length) throw new Error('no matching proposals in the latest run');
      if (args.command === 'accept') {
        // Пакетное --impact пропускает конфликты с журналом; явно названный id по-прежнему даёт ошибку.
        const prior = await readAccepted(source.editedDir);
        const skipped = selected.filter((proposal) => !args.values.includes(proposal.id) && conflictsWithAccepted(prior, proposal));
        const chosen = selected.filter((proposal) => !skipped.includes(proposal));
        // --delegation: принимает агент от имени автора (DELEGATION.md); человек за терминалом — без него.
        // Агент в оболочке без --delegation — не автор: принять правки он не может (DELEGATION.md §1).
        const auth = await authorizeAcceptance(source.workspaceDir, cliActor(process.env, Boolean(args.delegation)), args.delegation);
        const accepted = await acceptAuthorized(source.editedDir, chosen, auth, args.unverified);
        const results = await buildEdited({ book: source.book, editedDir: source.editedDir, accepted, manifestText: source.manifestText });
        summary = { command: 'accept', accepted: chosen.map((proposal) => proposal.id), results, warnings: skipped.map((proposal) => `conflicting-acceptance skipped: ${proposal.id}`) };
        if (results.some((item) => item.status === 'stale' || item.status === 'conflict')) process.exitCode = 2;
      } else {
        const auth = await authorizeAcceptance(source.workspaceDir, cliActor(process.env, Boolean(args.delegation)), args.delegation);
        const g = auth.grant?.delegation;
        await rejectProposals(source.stateDir, selected, auth.acceptedBy, source.editedDir, g ? { authority: 'delegated', authorized_by: g.granted_by, delegation_id: g.id } : {});
        if (auth.grant) await journal(auth.grant.dir, { capability: 'amendeor.accept', performed_by: auth.acceptedBy, authorized_by: g!.granted_by, delegation_id: g!.id, delegation_hash: delegationHash(g!), subject: `reject proposals ${selected.map((p) => p.id).join(', ')}` });
        await buildEdited({ book: source.book, editedDir: source.editedDir, accepted: await readAccepted(source.editedDir), manifestText: source.manifestText });
        summary = { command: 'reject', rejected: selected.map((proposal) => proposal.id) };
      }
      print(summary, args.json);
    }
  } finally { await release(); }
}

// --delegation на edit и check (DELEGATION.md): агент тратит от имени автора в пределах amendeor.edit и бюджета.
// Без флага — человек за терминалом, как раньше. Каждый вызов модели проходит через счётчик (provider/meter.ts);
// отказ останавливает траты, команда завершается с кодом 2 и называет, чего не хватает.
async function underDelegation<T>(source: { workspaceDir?: string }, id: string | undefined, subject: string, run: () => Promise<T>): Promise<T> {
  const actor = cliActor(process.env, Boolean(id));
  if (!id && actor === 'human:cli') return run();
  if (!id) {
    // Агент без делегирования: правила работают, ни один платный вызов не уходит.
    const m: Meter = { spent: 0, refused: `${actor} ran this without --delegation; model passes need a delegation that allows amendeor.edit, or the author running it` };
    try { return await meter.run(m, run); } finally { if (m.blocked) { process.stderr.write(`not-delegated: ${m.refused}\n`); process.exitCode = 2; } }
  }
  if (!source.workspaceDir) throw new Error('not-delegated: a delegation lives in a Codicora workspace; this target has none');
  const grant = await requireDelegation(source.workspaceDir, id, 'amendeor.edit');
  const limits = grant.delegation.limits;
  const m: Meter = typeof limits?.max_spend === 'number' && limits.currency
    ? { spent: 0, ctx: { workspaceDir: source.workspaceDir, id, capability: 'amendeor.edit', actor, subject, delegation_hash: delegationHash(grant.delegation) } }
    : { spent: 0, refused: 'the delegation sets no spending limit (limits.max_spend), so it covers no model call' };
  try {
    return await meter.run(m, run);
  } finally {
    await journal(grant.dir, { capability: 'amendeor.edit', performed_by: actor, authorized_by: grant.delegation.granted_by, delegation_id: id, delegation_hash: delegationHash(grant.delegation), subject,
      ...(m.spent ? { spent: Math.round(m.spent * 1e6) / 1e6, currency: limits?.currency } : {}), ...(m.refused ? { outcome: 'refused', reason: m.refused } : {}) });
    if (m.refused) { process.stderr.write(`not-delegated: ${m.refused}\n`); process.exitCode = 2; }
  }
}

function print(value: unknown, asJson: boolean): void {
  if (asJson) { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); return; }
  const result = value as { command: string; guide?: string; accepted?: string[]; rejected?: string[]; results?: Array<{ id: string; status: string; detail?: string }>; warnings?: string[]; chapters?: number; scenes?: number; words?: number; language?: string; hotspots?: unknown[]; formulaic?: Array<{ id: string; chapter: string; scene: string; quote: string }>; findings?: Array<{ id: string; kind?: string; principle?: string; chapter: string; scene: string; quote: string; reason: string }>; contextual?: { status: string; windows?: number; cached?: number; failures?: Array<{ chapter: string; scene: string; reason: string }>; discarded?: Array<{ chapter: string; scene: string; reason: string }> }; count?: number; run_id?: string; proposals?: number; message?: string; changes?: Array<{ id: string; state: string }> };
  if (result.command === 'inspect') {
    process.stdout.write(`inspect: ${result.chapters} chapters, ${result.scenes} scenes, ${result.words} words, ${result.language}; ${result.hotspots?.length ?? 0} hotspots; ${result.formulaic?.length ?? 0} formulaic passages\n`);
    for (const hit of result.formulaic ?? []) process.stdout.write(`  ${hit.chapter}/${hit.scene} ${hit.id}: ${hit.quote}\n`);
    return;
  }
  if (result.command === 'edit') { process.stdout.write(`edit: ${result.proposals} proposals, run ${result.run_id} (${result.message})\n`); return; }
  if (result.command === 'check') {
    process.stdout.write(`check: ${result.count} ${result.guide} finding(s); contextual ${result.contextual?.status ?? 'unknown'}${result.contextual?.windows === undefined ? '' : ` (${result.contextual.windows} windows, ${result.contextual.cached ?? 0} cached)`}\n`);
    for (const hit of result.findings ?? []) process.stdout.write(`  ${hit.chapter}/${hit.scene} ${hit.kind === 'contextual' ? hit.principle : hit.id}: ${hit.quote} — ${hit.reason}\n`);
    for (const failure of result.contextual?.failures ?? []) process.stdout.write(`  failed ${failure.chapter}/${failure.scene}: ${failure.reason}\n`);
    if (result.contextual?.discarded?.length) process.stdout.write(`  discarded ${result.contextual.discarded.length} candidate(s)\n`);
    return;
  }
  if (result.command === 'diff') { for (const change of result.changes ?? []) process.stdout.write(`${change.state} ${change.id}\n`); return; }
  process.stdout.write(`${result.command}: ${[...(result.accepted ?? []), ...(result.rejected ?? [])].join(', ') || `${result.results?.length ?? 0} edit(s)`}\n`);
  for (const item of result.results ?? []) process.stdout.write(`  ${item.status} ${item.id}${item.detail ? ` — ${item.detail}` : ''}\n`);
  for (const warning of result.warnings ?? []) process.stderr.write(`amendeor: warning: ${warning}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`amendeor: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
