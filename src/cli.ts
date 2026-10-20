#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSource } from './source/index.ts';
import { readRun } from './run/store.ts';
import { acquireLock } from './run/lock.ts';
import { acceptProposals, conflictsWithAccepted, readAccepted, rejectProposals } from './edited/decisions.ts';
import { buildEdited, validateEditedPaths } from './edited/build.ts';
import { acceptAuthorized, acceptUnverifiedDelegated, authorizeAcceptance, cliActor, delegationHash, journal, requireDelegation } from './edited/authority.ts';
import { meter, type Meter } from './provider/meter.ts';
import { loadConfig } from './config.ts';
import { loadPack } from './lang/pack.ts';
import { computeMetrics } from './metrics/index.ts';
import { inspectSummary, renderReport, currentDecisionStatus } from './report.ts';
import { editMechanical } from './edit/mechanical.ts';
import { diffRuns } from './diff.ts';
import { sha256, normalizeText } from './hash.ts';
import { writeFindingsRun } from './checks/findings.ts';
import { checkGuide, dedupeFindings, type Guide } from './checks/guide.ts';
import { noraGal } from './checks/nora-gal.ts';
import { infostyle } from './checks/infostyle.ts';
import { englishGuides } from './checks/en-guides.ts';
import { checkGuideContextual } from './checks/guide-context.ts';
import { checkBookPass } from './checks/book-pass.ts';
import { esgardeorHabits, latestBookRun, thinHabits } from './checks/habits.ts';

const guides: Record<string, Guide> = { 'nora-gal': noraGal, infostyle, ...Object.fromEntries(englishGuides.map((guide) => [guide.id, guide])) };

type Args = { command: string; target: string; values: string[]; lang?: string; out?: string; json: boolean; impact?: string; unverified: boolean; mode: string; run?: string; noCache: boolean; resume?: string; guide?: string; rulesOnly: boolean; delegation?: string; findings: boolean; passes?: number };
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
    else if (['--lang', '--out', '--impact', '--mode', '--run', '--resume', '--guide', '--delegation', '--passes'].includes(item)) {
      const value = argv[++index]; if (!value) throw new Error(`${item} requires a value`);
      if (item === '--lang') result.lang = value;
      if (item === '--out') result.out = value;
      if (item === '--impact') result.impact = value;
      if (item === '--mode') result.mode = value;
      if (item === '--run') result.run = value;
      if (item === '--resume') result.resume = value;
      if (item === '--guide') result.guide = value;
      if (item === '--delegation') result.delegation = value;
      if (item === '--passes') { result.passes = Number(value); if (!Number.isInteger(result.passes) || result.passes < 1) throw new Error('--passes needs a whole number of at least 1'); }
    } else if (item.startsWith('-')) throw new Error(`unknown option: ${item}`);
    else result.values.push(item);
  }
  if (command === 'accept' && result.impact && result.impact !== 'mechanical') throw new Error('--impact supports only mechanical');
  if (command === 'edit' && !['mechanical', 'proofread', 'copy', 'full'].includes(result.mode)) throw new Error(`unknown edit mode: ${result.mode}`);
  if (result.delegation && !['accept', 'reject', 'edit', 'check'].includes(command)) throw new Error('--delegation is only valid with accept, reject, edit and check');
  // Под делегированием непроверенные правки — только поименно, без пакета (--impact): автор доверил список, а не класс.
  if (result.delegation && result.unverified && (command !== 'accept' || result.impact || !result.values.length)) throw new Error('--delegation --unverified accepts only proposals named by id (no --impact), and needs amendeor.accept-unverified');
  if (result.guide && command !== 'check') throw new Error('--guide is only valid with check');
  if (result.rulesOnly && command !== 'check') throw new Error('--rules-only is only valid with check');
  if (result.findings && command !== 'check') throw new Error('--findings is only valid with check');
  if (result.passes && result.guide !== 'book') throw new Error('--passes is only valid with check --guide book');
  if (result.guide === 'habits' && result.rulesOnly) throw new Error('check --guide habits is a model pass; it has no rules to run alone');
  if (command === 'check' && !(result.guide && (['book', 'habits'].includes(result.guide) || Object.hasOwn(guides, result.guide)))) throw new Error(`check requires --guide ${[...Object.keys(guides), 'book', 'habits'].join('|')}`);
  return result;
}

async function main(): Promise<void> {
  if (process.argv[2] === 'serve') { await (await import('./serve.ts')).serve(process.argv.slice(3)); return; }
  const args = parseArgs(process.argv.slice(2));
  const modelConfig = (args.command === 'check' && !args.rulesOnly) || (args.command === 'edit' && args.mode !== 'mechanical')
    ? { installationConfig: fileURLToPath(new URL('../amendeor.yaml', import.meta.url)) } : {};
  const preliminaryConfig = await loadConfig({ ...modelConfig, cli: args.lang ? { language: args.lang } : undefined });
  const source = await openSource(args.target, { lang: args.lang ?? preliminaryConfig.config.language, out: args.out });
  if (['edit', 'accept', 'reject', 'build'].includes(args.command)) {
    if (source.manuscriptDir && path.resolve(source.manuscriptDir) === path.resolve(source.editedDir)) {
      throw new Error('edited/ is a read-only input; run accept, reject, or build against the workspace or manuscript/');
    }
    await validateEditedPaths(source.book, source.editedDir, source.manuscriptDir);
  }
  const loadedConfig = source.workspaceDir ? await loadConfig({ ...modelConfig, workspaceDir: source.workspaceDir, cli: args.lang ? { language: args.lang } : undefined }) : preliminaryConfig;
  loadedConfig.config.language = source.book.lang;
  if (args.command === 'inspect' || args.command === 'check' || args.command === 'edit') {
    const pack = await loadPack(source.book.lang, source.book.chapters.map((chapter) => chapter.text).join('\n'));
    if (pack.warning) process.stderr.write(`warning: ${pack.warning}\n`);
    if (args.command === 'inspect') {
      const summary = inspectSummary(source.book, pack, computeMetrics(source.book, pack.pack), source.warnings);
      print({ command: 'inspect', ...summary }, args.json); return;
    }
    if (args.command === 'check' && args.guide === 'habits') {
      // Прореживание привычек из последнего прохода по книге: все вхождения → запрос → находки style.book.thin.
      const startedAt = new Date().toISOString();
      if (!source.findingsDir || !source.workspaceDir) throw new Error('check --guide habits reads the last check --guide book run: it needs a Codicora workspace');
      const previous = await latestBookRun(source.findingsDir, source.book);
      const counted = await esgardeorHabits(source.findingsDir, source.workspaceDir, source.book, previous.habits);
      if (counted.skipped) process.stderr.write(`habits: Esgardeor's repetitions skipped: ${counted.skipped}\n`);
      const habits = [...previous.habits, ...counted.habits];
      if (!habits.length) throw new Error('the last amendeor findings run has no book.habit findings: run check --guide book --findings first (Esgardeor counted no usable repetition either)');
      const result = await underDelegation(source, args.delegation, 'check --guide habits', () => thinHabits(source.book, pack.pack, loadedConfig, source.stateDir, habits, args.noCache));
      if (args.findings) {
        const written = await writeFindingsRun(source.findingsDir, source.workspaceDir, source.book, [...previous.items, ...result.findings], { guide: 'book+habits', startedAt, stages: [
          { name: 'habits', status: result.status === 'refused' ? 'partial' : result.status, failures: result.failures.map((f) => ({ node_id: 'book', reason: f.reason })) }] });
        process.stderr.write(`findings/amendeor/runs/${written.runId}: ${written.count} finding(s), ${result.findings.length} habit replacement(s) from ${result.uses} uses of ${result.habits} habits\n`);
      }
      print({ command: 'check', guide: 'habits', version: 'habits-1', count: result.findings.length, findings: result.findings, counted: result.counted,
        contextual: { status: result.status, windows: result.requests, cached: result.cached, failures: result.failures, discarded: result.discarded, ledger: result.ledger } }, args.json);
      if (result.status !== 'ok') process.exitCode = 2;
      return;
    }
    if (args.command === 'check' && args.guide === 'book') {
      // Проход по всей книге: без каталога принципов и сигналов, на любом языке рукописи.
      const startedAt = new Date().toISOString();
      if (args.rulesOnly) throw new Error('check --guide book is a model pass; it has no rules to run alone');
      const result = await underDelegation(source, args.delegation, 'check --guide book', () => checkBookPass(source.book, pack.pack, loadedConfig, source.stateDir, args.noCache, args.passes ?? 2));
      if (args.findings) {
        if (!source.findingsDir || !source.workspaceDir) throw new Error('--findings needs a Codicora workspace (codicora.yaml)');
        const written = await writeFindingsRun(source.findingsDir, source.workspaceDir, source.book, result.findings, { guide: 'book', startedAt, stages: [
          { name: 'book-pass', status: result.status === 'refused' ? 'partial' : result.status, failures: result.failures.map((f) => ({ node_id: 'book', reason: f.reason })) }] });
        process.stderr.write(`findings/amendeor/runs/${written.runId}: ${written.count} finding(s)\n`);
      }
      print({ command: 'check', guide: 'book', version: 'book-pass-1', count: result.findings.length, findings: result.findings,
        contextual: { status: result.status, windows: result.passes, cached: result.cached, failures: result.failures, discarded: result.discarded, ledger: result.ledger } }, args.json);
      if (result.status !== 'ok') process.exitCode = 2;
      return;
    }
    if (args.command === 'check') {
      const startedAt = new Date().toISOString();
      const guide = guides[args.guide!]!;
      if (pack.pack.language !== guide.language) throw new Error(`${guide.id} checks ${guide.language} manuscripts; this book is ${pack.pack.language}`);
      const patterns = checkGuide(guide, source.book, pack.pack);
      const contextual = args.rulesOnly ? undefined : await underDelegation(source, args.delegation, `check --guide ${guide.id}`, () => checkGuideContextual(guide, source.book, pack.pack, loadedConfig, source.stateDir, args.noCache));
      const findings = dedupeFindings([...patterns, ...(contextual?.findings ?? [])]);
      if (args.findings) {
        if (!source.findingsDir || !source.workspaceDir) throw new Error('--findings needs a Codicora workspace (codicora.yaml)');
        const written = await writeFindingsRun(source.findingsDir, source.workspaceDir, source.book, findings, { guide: guide.id, startedAt, stages: [
          { name: 'patterns', status: 'ok' },
          contextual ? { name: 'contextual', status: contextual.status === 'refused' ? 'partial' : contextual.status, failures: contextual.failures.map((f) => ({ node_id: `${f.chapter}/${f.scene}`, reason: f.reason })) } : { name: 'contextual', status: 'skipped' }] });
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
      print({ command: 'edit', mode: args.mode, run_id: result.run_id, proposals: result.proposals.length, outcomes: editOutcomes(result.run), summary: result.run.summary, stages: result.run.stages, message: loadedConfig.config.profiles.edit ? 'rules + model' : 'rules only' }, args.json);
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
        const actor = cliActor(process.env, Boolean(args.delegation));
        let accepted;
        if (args.delegation && args.unverified) {
          // Проверенные и непроверенные — разные способности; каждая нужна для своей части списка.
          // Обе способности проверяются до первого принятия: иначе половина списка прошла бы, а вторая упала.
          const unverified = chosen.filter((proposal) => proposal.unverified), verified = chosen.filter((proposal) => !proposal.unverified);
          const unverifiedAuth = unverified.length ? await authorizeAcceptance(source.workspaceDir, actor, args.delegation, 'amendeor.accept-unverified') : null;
          const verifiedAuth = verified.length ? await authorizeAcceptance(source.workspaceDir, actor, args.delegation) : null;
          if (unverifiedAuth) await acceptUnverifiedDelegated(source.editedDir, unverified, unverifiedAuth);
          if (verifiedAuth) await acceptAuthorized(source.editedDir, verified, verifiedAuth);
          accepted = await readAccepted(source.editedDir);
        } else accepted = await acceptAuthorized(source.editedDir, chosen, await authorizeAcceptance(source.workspaceDir, actor, args.delegation), args.unverified);
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

// Исходы правок прогона (AUDIT A-3d): предложено, на проверку (review-only, только поштучно), отклонено фильтром,
// не проверено (сбой verifier, провайдера или отказ в тратах). Отказ фильтра — не сбой.
function editOutcomes(run: Record<string, unknown>): { offered: number; review_only: number; rejected: number; failed: { verifier: number; provider: number; spend_refused: number }; model_refused?: { windows_done: number; windows_skipped: number } } {
  const guard = (run.guard ?? {}) as Record<string, number>;
  const model = (run.stages as Array<{ name: string; refused?: { windows_done: number; windows_skipped: number } }>).find((stage) => stage.name === 'model');
  return { offered: guard.offered ?? 0, review_only: guard.review_only ?? 0, rejected: guard.rejected ?? 0, failed: { verifier: guard.verifier_failures ?? 0, provider: guard.provider_failures ?? 0, spend_refused: guard.spend_refused ?? 0 },
    ...(model?.refused ? { model_refused: { windows_done: model.refused.windows_done, windows_skipped: model.refused.windows_skipped } } : {}) };
}

function print(value: unknown, asJson: boolean): void {
  if (asJson) { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); return; }
  const result = value as { command: string; guide?: string; accepted?: string[]; rejected?: string[]; results?: Array<{ id: string; status: string; detail?: string }>; warnings?: string[]; chapters?: number; scenes?: number; words?: number; language?: string; hotspots?: unknown[]; formulaic?: Array<{ id: string; chapter: string; scene: string; quote: string }>; findings?: Array<{ id: string; kind?: string; principle?: string; chapter: string; scene: string; quote: string; reason: string }>; contextual?: { status: string; windows?: number; cached?: number; failures?: Array<{ chapter: string; scene: string; reason: string }>; discarded?: Array<{ chapter: string; scene: string; reason: string }> }; count?: number; run_id?: string; proposals?: number; message?: string; outcomes?: ReturnType<typeof editOutcomes>; changes?: Array<{ id: string; state: string }> };
  if (result.command === 'inspect') {
    process.stdout.write(`inspect: ${result.chapters} chapters, ${result.scenes} scenes, ${result.words} words, ${result.language}; ${result.hotspots?.length ?? 0} hotspots; ${result.formulaic?.length ?? 0} formulaic passages\n`);
    for (const hit of result.formulaic ?? []) process.stdout.write(`  ${hit.chapter}/${hit.scene} ${hit.id}: ${hit.quote}\n`);
    return;
  }
  if (result.command === 'edit') {
    const o = result.outcomes!; const failed = o.failed.verifier + o.failed.provider + o.failed.spend_refused;
    process.stdout.write(`edit: ${result.proposals} proposals (${o.offered} model offered, ${o.review_only} review-only), ${o.rejected} rejected, ${failed} unchecked, run ${result.run_id} (${result.message})\n`);
    if (o.review_only) process.stdout.write(`  ${o.review_only} review-only: typo-shaped corrections a guard stopped; accept only one by one: amendeor accept <target> <id> --unverified\n`);
    if (failed) process.stdout.write(`  unchecked: ${o.failed.verifier} verifier, ${o.failed.provider} provider, ${o.failed.spend_refused} spend refused — see amendeor report\n`);
    if (o.model_refused) process.stdout.write(`  model pass stopped at the first refused call: ${o.model_refused.windows_done} window(s) done, ${o.model_refused.windows_skipped} not sent; rules proposals are recorded\n`);
    return;
  }
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
