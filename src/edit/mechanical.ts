import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { OpenedSource } from '../source/index.ts';
import type { LoadedConfig, Config } from '../config.ts';
import type { LoadedPack } from '../lang/pack.ts';
import { Cache } from '../cache.ts';
import { canonicalJson, normalizeText, sha256 } from '../hash.ts';
import { computeMetrics } from '../metrics/index.ts';
import { inspectSummary, renderReport } from '../report.ts';
import { properNouns } from '../text/names.ts';
import { enabledRules, ruleContext, ruleSetVersion, bookWordCounts, type ProposalDraft } from '../rules/index.ts';
import { makeProposal } from '../proposal/identity.ts';
import type { Proposal } from '../proposal/schema.ts';
import { newRunId, writeRun, readRun } from '../run/store.ts';
import { acceptProposals, readRejected } from '../edited/decisions.ts';
import { buildEdited } from '../edited/build.ts';
import { balanceWarnings } from '../rules/balance.ts';
import { modelPass } from './pass.ts';
import { guardProposals } from '../guard/index.ts';
import { TITLE_SCENE_ID, type Scene } from '../book.ts';
import { titleRules } from '../rules/index.ts';

export interface EditResult { run_id: string; proposals: Proposal[]; run: Record<string, unknown>; report: string }

function redactConfig(config: Config): Record<string, unknown> {
  const safe = structuredClone(config) as Config;
  for (const provider of Object.values(safe.providers)) if (provider.api_key) provider.api_key = '[redacted]';
  return safe;
}

function occurrenceBefore(text: string, target: string, start: number): number {
  if (!target) return 0;
  return text.slice(0, start).split(target).length - 1;
}

async function previousRunId(stateDir: string): Promise<string | null> {
  try { return (JSON.parse(await readFile(path.join(stateDir, 'latest.json'), 'utf8')) as { run_id: string }).run_id; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}

export async function editMechanical(source: OpenedSource, loaded: LoadedConfig, language: LoadedPack, options: { noCache?: boolean; runId?: string; mode?: string } = {}): Promise<EditResult> {
  const started = new Date().toISOString();
  const runId = options.runId ?? newRunId();
  const cache = new Cache(source.stateDir, options.noCache);
  const activeRules = enabledRules(loaded.config, source.book.lang);
  const names = properNouns(source.book, language.pack);
  const wordCounts = bookWordCounts(source.book);
  const bookHash = sha256(canonicalJson(source.book.chapters.map((chapter) => [chapter.slug, chapter.title, chapter.scenes.map((scene) => scene.contentHash)])));
  const metrics = computeMetrics(source.book, language.pack);
  const summary = inspectSummary(source.book, language, metrics, source.warnings);
  const rejected = await readRejected(source.stateDir);
  const proposals = new Map<string, Proposal>();
  const failures: Array<{ node_id: string; reason: string }> = [];
  const diagnostics: Array<{ node_id: string; message: string }> = [];
  let hits = 0; let cached = 0; let computed = 0; let failed = 0;
  for (const chapter of source.book.chapters) for (const scene of [
    { id: TITLE_SCENE_ID, text: chapter.title, implicit: true, contentHash: sha256(normalizeText(chapter.title)), start: 0, end: chapter.title.length } satisfies Scene,
    ...chapter.scenes
  ]) {
    const rulesForScene = scene.id === TITLE_SCENE_ID ? activeRules.filter((rule) => titleRules.includes(rule)) : activeRules;
    const failuresBeforeScene = failed;
    for (const message of balanceWarnings(scene.text)) diagnostics.push({ node_id: `${chapter.slug}/${scene.id}`, message });
    const inputs = { text: scene.text, surface: scene.id === TITLE_SCENE_ID ? 'title' : 'scene', bookHash, config: { preserve: loaded.config.preserve, normalize: loaded.config.normalize, rules: loaded.config.rules }, pack: language.pack, ruleSetVersion };
    let drafts = await cache.read<Array<ProposalDraft & { ruleId: string; category: Proposal['category']; impact: Proposal['impact'] }>>('rules', inputs);
    const fromCache = drafts !== undefined;
    if (fromCache) cached++;
    else {
      drafts = [];
      const context = ruleContext(source.book, loaded.config, language.pack, scene, names, wordCounts);
      for (const rule of rulesForScene) {
        try {
          for (const draft of rule.detect(scene, context)) drafts.push({ ...draft, ruleId: rule.id, category: draft.category ?? rule.category, impact: draft.impact ?? rule.impact });
        } catch (error) { failed++; failures.push({ node_id: `${chapter.slug}/${scene.id}/${rule.id}`, reason: (error as Error).message }); }
      }
      computed++;
    }
    const sceneDrafts = drafts ?? [];
    hits += sceneDrafts.length;
    for (const draft of sceneDrafts) {
      try {
        const proposal = makeProposal({
          category: draft.category, chapter: chapter.slug, scene: scene.id, target: draft.target, replacement: draft.replacement,
          before: scene.text.slice(Math.max(0, draft.start - 60), draft.start), after: scene.text.slice(draft.start + draft.target.length, draft.start + draft.target.length + 60),
          occurrence: occurrenceBefore(scene.text, draft.target, draft.start), run_id: runId, impact: draft.impact,
          source: `rule:${draft.ruleId}`, confidence: 1, reason: draft.reason, content_hash: scene.contentHash,
          verification: { passes: 0, agreed: 0, semantic_risk: 'none', voice: 'ok' }
        });
        if (rejected.some((record) => record.proposal_id === proposal.id && record.target_hash === proposal.target.hash)) continue;
        if (!proposals.has(proposal.id)) proposals.set(proposal.id, proposal);
      } catch (error) { failed++; failures.push({ node_id: `${chapter.slug}/${scene.id}/${draft.ruleId}`, reason: (error as Error).message }); }
    }
    if (!fromCache && failed === failuresBeforeScene) await cache.write('rules', inputs, sceneDrafts);
  }
  const mode = options.mode ?? 'mechanical';
  const model = await modelPass(source, loaded, language, mode, runId, [...proposals.values()], options.noCache);
  const guard = await guardProposals(source, loaded, language, model.proposals, options.noCache, mode);
  for (const proposal of guard.proposals) if (!proposals.has(proposal.id)) proposals.set(proposal.id, proposal);
  const list = [...proposals.values()];
  const ledgerEntries = [...model.ledger, ...guard.ledger];
  const previousId = await previousRunId(source.stateDir);
  const inputs = source.book.chapters.map((chapter) => ({ path: chapter.file, content_hash: sha256(normalizeText(chapter.text)), title_hash: sha256(normalizeText(chapter.title)) }));
  const run: Record<string, unknown> = {
    schema: 'codicora.run/0.1', run_id: runId, tool: { name: 'amendeor', version: '0.1.0' }, started_at: started, finished_at: new Date().toISOString(),
    inputs: { files: inputs }, config: redactConfig(loaded.config), config_layers: loaded.winningLayer,
    stages: [{ name: 'rules', status: failed ? 'partial' : 'ok', hits, proposals: hits, units: { cached, computed, failed }, failures, diagnostics }, model.stage, guard.stage],
    guard: guard.stage,
    ledger: { entries: ledgerEntries, tokens_in: ledgerEntries.reduce((sum, entry) => sum + entry.tokens_in, 0), tokens_out: ledgerEntries.reduce((sum, entry) => sum + entry.tokens_out, 0), cost: ledgerEntries.some((entry) => entry.tokens_in + entry.tokens_out > 0 && entry.cost === null) ? null : ledgerEntries.reduce((sum, entry) => sum + (entry.cost ?? 0), 0), currency: ledgerEntries.find((entry) => entry.currency)?.currency ?? null, ms: ledgerEntries.reduce((sum, entry) => sum + entry.ms, 0) }, baseline: { previous_run_id: previousId, states: {} },
    counts: { by_impact: { mechanical: list.filter((item) => item.impact === 'mechanical').length, prose: list.filter((item) => item.impact === 'prose').length } },
    summary: { ...summary, hotspots: summary.hotspots.length }, warnings: summary.warnings, metadata: { rule_set_version: ruleSetVersion, pack_version: language.pack.version, mode, prompt_version: (model.stage as { prompt_version?: string }).prompt_version, model_id: (model.stage as { model_id?: string }).model_id }
  };
  const report = renderReport(run);
  await writeRun(source.stateDir, runId, { 'run.json': `${JSON.stringify(run, null, 2)}\n`, 'proposals.jsonl': list.map((proposal) => JSON.stringify(proposal)).join('\n') + (list.length ? '\n' : ''), 'rejected.jsonl': guard.rejected.map((item) => JSON.stringify(item)).join('\n') + (guard.rejected.length ? '\n' : ''), 'report.md': report }, Boolean(options.runId));
  if (loaded.config.auto_accept.includes('mechanical')) {
    const accepted = await acceptProposals(source.editedDir, list.filter((proposal) => proposal.impact === 'mechanical'));
    await buildEdited({ book: source.book, editedDir: source.editedDir, accepted, manifestText: source.manifestText });
  }
  return { run_id: runId, proposals: list, run, report };
}
