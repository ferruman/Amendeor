import type { OpenedSource } from '../source/index.ts';
import type { LoadedConfig } from '../config.ts';
import type { LoadedPack } from '../lang/pack.ts';
import type { Proposal } from '../proposal/schema.ts';
import { makeProposal } from '../proposal/identity.ts';
import { Cache } from '../cache.ts';
import { Gateway } from '../provider/gateway.ts';
import { copyEditPrompt, copyEditPromptVersion } from '../prompts/copy-edit.ts';
import { editWindows } from './windows.ts';
import { parseEdits, type ParsedEdit } from './parse.ts';
import { classifyEdit } from './classify.ts';
import { ruleSetVersion } from '../rules/index.ts';
import { computeMetrics } from '../metrics/index.ts';
import { scanFormulaicProse, formulaicCatalogVersion } from '../patterns/formulaic.ts';

export interface ModelPassResult { proposals: Proposal[]; stage: Record<string, unknown>; ledger: Gateway['ledger'] }
export async function modelPass(source: OpenedSource, loaded: LoadedConfig, pack: LoadedPack, mode: string, runId: string, ruleProposals: Proposal[], noCache = false): Promise<ModelPassResult> {
  const profile = loaded.config.profiles.edit;
  if (!profile) return { proposals: [], stage: { name: 'model', status: 'skipped', reason: 'edit profile absent', windows: 0 }, ledger: [] };
  const gateway = new Gateway(loaded.config, pack.pack);
  const cache = new Cache(source.stateDir, noCache);
  const formulaic = scanFormulaicProse(source.book, pack.pack);
  const protectedSpans = source.book.chapters.flatMap((chapter) => chapter.scenes.flatMap((scene) => loaded.config.preserve.flatMap((phrase) => {
    if (['sentence-fragments', 'dialect', 'informal-dialogue'].includes(phrase) || !scene.text.includes(phrase)) return [];
    const spans: Array<{ chapter: string; scene: string; start: number; end: number }> = [];
    let from = 0, start: number;
    while ((start = scene.text.indexOf(phrase, from)) >= 0) { spans.push({ chapter: chapter.slug, scene: scene.id, start, end: start + phrase.length }); from = start + phrase.length; }
    return spans;
  })));
  const windows = editWindows(source.book, mode, profile.context_budget ?? 4096, ruleProposals, computeMetrics(source.book, pack.pack).hotspots, formulaic, protectedSpans);
  const proposals: Proposal[] = []; const failures: Array<{ node_id: string; reason: string }> = [];
  const discarded: Array<{ node_id: string; reason: string }> = [];
  let noChange = 0, cached = 0, sent = 0;
  const noChangeByChapter: Record<string, number> = {};
  const windowsByChapter: Record<string, number> = {};
  for (const window of windows) {
    windowsByChapter[window.chapter] = (windowsByChapter[window.chapter] ?? 0) + 1;
    const key = { window, mode, config: { preserve: loaded.config.preserve, normalize: loaded.config.normalize, avoid: loaded.config.avoid }, profile, provider: loaded.config.providers[profile.provider], promptVersion: copyEditPromptVersion, formulaicCatalogVersion, ruleSetVersion, packVersion: pack.pack.version };
    let edits = await cache.read<ParsedEdit[]>('model', key);
    if (edits) cached++;
    else {
      const prompt = copyEditPrompt(pack.pack, window.text, window.before, window.after, mode, loaded.config, undefined, window.signals);
      try {
        const answer = await gateway.complete('edit', 'edit', prompt.system, prompt.prompt, Math.max(500, window.text.length / 2));
        sent++;
        try {
          const parsed = parseEdits(answer.text, window.text); edits = parsed.edits;
          for (const item of parsed.discarded) discarded.push({ node_id: window.chapter + '/' + window.scene, reason: item.reason });
          if (parsed.discarded.length && !parsed.edits.length) throw new Error('all edits discarded: ' + parsed.discarded.map((item) => item.reason).join(', '));
        } catch (parseError) {
          const retry = copyEditPrompt(pack.pack, window.text, window.before, window.after, mode, loaded.config, (parseError as Error).message, window.signals);
          const answer2 = await gateway.complete('edit-parse-retry', 'edit', retry.system, retry.prompt, Math.max(500, window.text.length / 2));
          sent++;
          const parsed = parseEdits(answer2.text, window.text); edits = parsed.edits;
          for (const item of parsed.discarded) discarded.push({ node_id: window.chapter + '/' + window.scene, reason: item.reason });
          if (parsed.discarded.length && !parsed.edits.length) throw new Error('retry discarded all edits: ' + parsed.discarded.map((item) => item.reason).join(', '));
        }
        await cache.write('model', key, edits);
      } catch (error) {
        failures.push({ node_id: window.chapter + '/' + window.scene + '/' + window.start, reason: error instanceof Error ? error.message : String(error) });
        continue;
      }
    }
    if (!edits?.length) { noChange++; noChangeByChapter[window.chapter] = (noChangeByChapter[window.chapter] ?? 0) + 1; continue; }
    const scene = source.book.chapters.find((chapter) => chapter.slug === window.chapter)!.scenes.find((item) => item.id === window.scene)!;
    for (const edit of edits) {
      if (mode === 'mechanical' && !['grammar', 'spelling'].includes(edit.category)) { discarded.push({ node_id: window.chapter + '/' + window.scene, reason: 'category-outside-mechanical-model-pass' }); continue; }
      if (!window.text.includes(edit.target)) { discarded.push({ node_id: window.chapter + '/' + window.scene, reason: 'cached-target-not-verbatim' }); continue; }
      const start = window.start + window.text.indexOf(edit.target);
      const matchingSignals = window.signals.filter((signal) => start < signal.end && start + edit.target.length > signal.start);
      if (edit.category === 'prose-pattern' && !matchingSignals.length) { discarded.push({ node_id: window.chapter + '/' + window.scene, reason: 'prose-pattern-without-trigger-overlap' }); continue; }
      const removesSignal = matchingSignals.some((signal) => edit.target.includes(signal.quote) && !edit.replacement.includes(signal.quote));
      const category = removesSignal ? 'prose-pattern' : edit.category;
      const occurrence = scene.text.slice(0, start).split(edit.target).length - 1;
      try {
        proposals.push(makeProposal({ chapter: window.chapter, scene: window.scene, category, target: edit.target, replacement: edit.replacement,
          before: scene.text.slice(Math.max(0, start - 60), start), after: scene.text.slice(start + edit.target.length, start + edit.target.length + 60),
          occurrence, run_id: runId, source: 'model', reason: edit.reason, impact: category === 'prose-pattern' ? 'prose' : classifyEdit(edit.target, edit.replacement, pack.pack),
          content_hash: scene.contentHash, unverified: true, source_findings: category === 'prose-pattern' ? matchingSignals.map((signal) => signal.id) : undefined }));
      } catch (error) { discarded.push({ node_id: window.chapter + '/' + window.scene, reason: (error as Error).message }); }
    }
  }
  return { proposals, stage: { name: 'model', status: failures.length ? 'partial' : 'ok', windows: windows.length, windows_by_chapter: windowsByChapter, sent, cached, no_change: noChange, no_change_by_chapter: noChangeByChapter, candidates: proposals.length, discarded, failures, prompt_version: copyEditPromptVersion, model_id: profile.model, formulaic_hits: formulaic, formulaic_catalog_version: formulaicCatalogVersion }, ledger: gateway.ledger };
}
