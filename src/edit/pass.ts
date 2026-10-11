import type { OpenedSource } from '../source/index.ts';
import { effectivePreserve, preserveKeywords, type LoadedConfig } from '../config.ts';
import type { LoadedPack } from '../lang/pack.ts';
import type { Proposal } from '../proposal/schema.ts';
import { makeProposal } from '../proposal/identity.ts';
import { Cache } from '../cache.ts';
import { Gateway } from '../provider/gateway.ts';
import { SpendRefused } from '../provider/meter.ts';
import { copyEditPrompt, copyEditPromptVersion, diagnosticEditPrompt, diagnosticPromptVersion } from '../prompts/copy-edit.ts';
import { mergePasses, type MergeConflict, type MergeRecord, type Pass, type Placed } from './merge.ts';
import { editWindows } from './windows.ts';
import { parseEdits, type ParsedEdit } from './parse.ts';
import { classifyEdit } from './classify.ts';
import { ruleSetVersion } from '../rules/index.ts';
import { computeMetrics } from '../metrics/index.ts';
import { scanFormulaicProse, formulaicCatalogVersion } from '../patterns/formulaic.ts';
import { readFindings, isExternalFinding, type FindingsIntake } from '../findings/intake.ts';
import { changedSpan, spansTouch } from '../text/segment.ts';
import { TITLE_SCENE_ID } from '../book.ts';
import { sha256, normalizeText } from '../hash.ts';

export interface ModelPassResult { proposals: Proposal[]; conflicts?: MergeConflict[]; stage: Record<string, unknown>; ledger: Gateway['ledger'] }
export async function modelPass(source: OpenedSource, loaded: LoadedConfig, pack: LoadedPack, mode: string, runId: string, ruleProposals: Proposal[], noCache = false, intake?: FindingsIntake): Promise<ModelPassResult> {
  const profile = loaded.config.profiles.edit;
  if (!profile) return { proposals: [], stage: { name: 'model', status: 'skipped', reason: 'edit profile absent', windows: 0 }, ledger: [] };
  const gateway = new Gateway(loaded.config, pack.pack);
  const cache = new Cache(source.stateDir, noCache);
  const findings = intake ?? await readFindings(source);
  const formulaic = [...scanFormulaicProse(source.book, pack.pack), ...findings.signals];
  const protectedSpans = source.book.chapters.flatMap((chapter) => chapter.scenes.flatMap((scene) => effectivePreserve(loaded.config).flatMap((phrase) => {
    if (preserveKeywords.includes(phrase) || !scene.text.includes(phrase)) return [];
    const spans: Array<{ chapter: string; scene: string; start: number; end: number }> = [];
    let from = 0, start: number;
    while ((start = scene.text.indexOf(phrase, from)) >= 0) { spans.push({ chapter: chapter.slug, scene: scene.id, start, end: start + phrase.length }); from = start + phrase.length; }
    return spans;
  })));
  protectedSpans.push(...findings.protected);
  const windows = editWindows(source.book, mode, profile.context_budget ?? 4096, ruleProposals, computeMetrics(source.book, pack.pack).hotspots, formulaic, protectedSpans);
  const proposals: Proposal[] = []; const failures: Array<{ node_id: string; reason: string; pass?: Pass }> = [];
  const discarded: Array<{ node_id: string; reason: string; pass?: Pass }> = [];
  let noChange = 0, cached = 0, sent = 0;
  const noChangeByChapter: Record<string, number> = {};
  const windowsByChapter: Record<string, number> = {};
  const diagnostic = Boolean(profile.diagnostic);
  const conflicts: MergeConflict[] = []; const merges: MergeRecord[] = []; let merged = 0; const passCandidates = { standard: 0, diagnostic: 0 };
  // Один проход по окну: запрос, разбор, один повтор при ошибке разбора. Оба прохода видят один и тот же исходный текст.
  const request = async (window: (typeof windows)[number], pass: Pass): Promise<ParsedEdit[] | null> => {
    const key = { window, mode, config: { preserve: effectivePreserve(loaded.config), editorial_profile: loaded.config.editorial_profile ?? null, normalize: loaded.config.normalize, avoid: loaded.config.avoid }, profile, provider: loaded.config.providers[profile.provider], promptVersion: copyEditPromptVersion, formulaicCatalogVersion, ruleSetVersion, packVersion: pack.pack.version,
      ...(pass === 'diagnostic' ? { pass, diagnosticPromptVersion } : {}) };
    const cached_ = await cache.read<ParsedEdit[]>(pass === 'diagnostic' ? 'model-diagnostic' : 'model', key);
    if (cached_) { cached++; return cached_; }
    const build = pass === 'diagnostic' ? diagnosticEditPrompt : copyEditPrompt;
    const stage = pass === 'diagnostic' ? 'edit-diagnostic' : 'edit';
    try {
      const prompt = build(pack.pack, window.text, window.before, window.after, mode, loaded.config, undefined, window.signals, window.scene === TITLE_SCENE_ID);
      const answer = await gateway.complete(stage, 'edit', prompt.system, prompt.prompt, Math.max(500, window.text.length / 2));
      sent++;
      let edits: ParsedEdit[];
      try {
        const parsed = parseEdits(answer.text, window.text); edits = parsed.edits;
        for (const item of parsed.discarded) discarded.push({ node_id: window.chapter + '/' + window.scene, reason: item.reason, ...(diagnostic ? { pass } : {}) });
        if (parsed.discarded.length && !parsed.edits.length) throw new Error('all edits discarded: ' + parsed.discarded.map((item) => item.reason).join(', '));
      } catch (parseError) {
        const retry = build(pack.pack, window.text, window.before, window.after, mode, loaded.config, (parseError as Error).message, window.signals, window.scene === TITLE_SCENE_ID);
        const answer2 = await gateway.complete(stage + '-parse-retry', 'edit', retry.system, retry.prompt, Math.max(500, window.text.length / 2));
        sent++;
        const parsed = parseEdits(answer2.text, window.text); edits = parsed.edits;
        for (const item of parsed.discarded) discarded.push({ node_id: window.chapter + '/' + window.scene, reason: item.reason, ...(diagnostic ? { pass } : {}) });
        if (parsed.discarded.length && !parsed.edits.length) throw new Error('retry discarded all edits: ' + parsed.discarded.map((item) => item.reason).join(', '));
      }
      await cache.write(pass === 'diagnostic' ? 'model-diagnostic' : 'model', key, edits);
      return edits;
    } catch (error) {
      // Отказ в тратах не сбой окна: следующие окна получат тот же отказ, поэтому проход останавливается (AUDIT F5).
      if (error instanceof SpendRefused) throw error;
      failures.push({ node_id: window.chapter + '/' + window.scene + '/' + window.start, reason: error instanceof Error ? error.message : String(error), ...(diagnostic ? { pass } : {}) });
      return null;
    }
  };
  let refused: { reason: string; window: number } | undefined;
  for (const [windowIndex, window] of windows.entries()) {
    windowsByChapter[window.chapter] = (windowsByChapter[window.chapter] ?? 0) + 1;
    let standard: ParsedEdit[] | null, second: ParsedEdit[] | null;
    try {
      standard = await request(window, 'standard');
      second = diagnostic ? await request(window, 'diagnostic') : null;
    } catch (error) {
      if (!(error instanceof SpendRefused)) throw error;
      refused = { reason: error.message, window: windowIndex }; break;
    }
    // Окно без правок — только если ни один проход не упал; упавший проход уже записан в failures.
    if (!standard?.length && !second?.length) {
      if (standard !== null && (!diagnostic || second !== null)) { noChange++; noChangeByChapter[window.chapter] = (noChangeByChapter[window.chapter] ?? 0) + 1; }
      continue;
    }
    const chapter = source.book.chapters.find((item) => item.slug === window.chapter)!;
    const scene = window.scene === TITLE_SCENE_ID
      ? { text: chapter.title, contentHash: sha256(normalizeText(chapter.title)) }
      : chapter.scenes.find((item) => item.id === window.scene)!;
    const placed: Placed[] = [];
    for (const [pass, edits] of [['standard', standard], ['diagnostic', second]] as Array<[Pass, ParsedEdit[] | null]>) {
      if (!edits?.length) continue;
      const positions = (target: string) => { const found: number[] = []; for (let at = window.text.indexOf(target); at >= 0; at = window.text.indexOf(target, at + target.length)) found.push(at); return found; };
      for (const [index, edit] of edits.entries()) {
        const node = { node_id: window.chapter + '/' + window.scene, ...(diagnostic ? { pass } : {}) };
        if (mode === 'mechanical' && !['grammar', 'spelling'].includes(edit.category)) { discarded.push({ ...node, reason: 'category-outside-mechanical-model-pass' }); continue; }
        if (mode === 'proofread' && !['grammar', 'spelling', 'punctuation'].includes(edit.category)) { discarded.push({ ...node, reason: 'category-outside-proofread-model-pass' }); continue; }
        if (!window.text.includes(edit.target)) { discarded.push({ ...node, reason: 'cached-target-not-verbatim' }); continue; }
        // Цель, которая встречается в окне несколько раз, не указывает место правки. Её принимаем, только если модель
        // дала столько же одинаковых правок, сколько вхождений, — тогда они идут по порядку; иначе отказ, а не правка не того места.
        const found = positions(edit.target);
        const same = edits.filter((other) => other.target === edit.target);
        if (found.length > 1 && !(same.length === found.length && same.every((other) => other.replacement === edit.replacement))) { discarded.push({ ...node, reason: 'ambiguous-target-in-window' }); continue; }
        const start = window.start + found[found.length > 1 ? edits.slice(0, index).filter((other) => other.target === edit.target).length : 0]!;
        const changed = changedSpan(scene.text, start, start + edit.target.length, edit.replacement);
        if (findings.protected.some((hit) => hit.chapter === window.chapter && hit.scene === window.scene && spansTouch(changed, hit))) { discarded.push({ ...node, reason: 'protected-finding-status' }); continue; }
        const matchingSignals = window.signals.filter((signal) => start < signal.end && start + edit.target.length > signal.start);
        if (edit.category === 'prose-pattern' && !matchingSignals.length) { discarded.push({ ...node, reason: 'prose-pattern-without-trigger-overlap' }); continue; }
        const removesSignal = matchingSignals.some((signal) => edit.target.includes(signal.quote) && !edit.replacement.includes(signal.quote));
        const externalStyle = matchingSignals.some((signal) => isExternalFinding(signal.id)) && ['prose-pattern', 'repetition', 'redundancy', 'clarity', 'word-choice', 'sentence-structure'].includes(edit.category);
        const category = removesSignal || externalStyle ? 'prose-pattern' : edit.category;
        if (category === 'prose-pattern' && /\n\s*\n/u.test(edit.target)) { discarded.push({ ...node, reason: 'prose-pattern-crosses-paragraph' }); continue; }
        const occurrence = scene.text.slice(0, start).split(edit.target).length - 1;
        try {
          placed.push({ pass, start, proposal: makeProposal({ chapter: window.chapter, scene: window.scene, category, target: edit.target, replacement: edit.replacement,
            before: scene.text.slice(Math.max(0, start - 60), start), after: scene.text.slice(start + edit.target.length, start + edit.target.length + 60),
            occurrence, run_id: runId, source: 'model', reason: edit.reason, impact: category === 'prose-pattern' || (mode === 'proofread' && category === 'punctuation') ? 'prose' : classifyEdit(edit.target, edit.replacement, pack.pack),
            content_hash: scene.contentHash, unverified: true, source_findings: category === 'prose-pattern' ? matchingSignals.map((signal) => signal.id) : undefined }) });
          passCandidates[pass]++;
        } catch (error) { discarded.push({ ...node, reason: (error as Error).message }); }
      }
    }
    if (!diagnostic) { proposals.push(...placed.map((item) => item.proposal)); continue; }
    const result = mergePasses(scene.text, placed);
    proposals.push(...result.proposals); conflicts.push(...result.conflicts); merges.push(...result.merges); merged += result.merged;
  }
  return { proposals, conflicts, stage: { name: 'model', status: refused ? 'refused' : failures.length ? 'partial' : 'ok', windows: windows.length, ...(refused ? { refused: { reason: refused.reason, windows_done: refused.window, windows_skipped: windows.length - refused.window } } : {}), ...(diagnostic ? { passes: ['standard', 'diagnostic'], pass_candidates: passCandidates, merged_identical: merged, merge_conflicts: conflicts.length, conflicts, merges, diagnostic_prompt_version: diagnosticPromptVersion } : {}), windows_by_chapter: windowsByChapter, sent, cached, no_change: noChange, no_change_by_chapter: noChangeByChapter, candidates: proposals.length, discarded, failures, prompt_version: copyEditPromptVersion, model_id: profile.model, formulaic_hits: formulaic, formulaic_catalog_version: formulaicCatalogVersion }, ledger: gateway.ledger };
}
