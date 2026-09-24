import type { Book } from './book.ts';
import type { LoadedPack } from './lang/pack.ts';
import type { MetricsReport } from './metrics/index.ts';
import { scanFormulaicProse, type FormulaicHit } from './patterns/formulaic.ts';
import type { OpenedSource } from './source/index.ts';
import { readAccepted } from './edited/decisions.ts';
import { locate } from './proposal/locate.ts';

export interface InspectSummary { chapters: number; scenes: number; words: number; language: string; pack: { status: string; version: string; warning?: string }; hotspots: MetricsReport['hotspots']; formulaic: FormulaicHit[]; warnings: string[] }

export function inspectSummary(book: Book, loadedPack: LoadedPack, metrics: MetricsReport, warnings: string[] = []): InspectSummary {
  return {
    chapters: book.chapters.length, scenes: metrics.scenes.length, words: metrics.scenes.reduce((sum, scene) => sum + scene.words, 0),
    language: book.lang, pack: { status: loadedPack.status, version: loadedPack.pack.version, ...(loadedPack.warning ? { warning: loadedPack.warning } : {}) },
    hotspots: metrics.hotspots, formulaic: scanFormulaicProse(book, loadedPack.pack), warnings: [...warnings, ...(loadedPack.warning ? [loadedPack.warning] : [])]
  };
}

export function renderReport(run: Record<string, any>): string {
  const summary = run.summary ?? {};
  const stages = Array.isArray(run.stages) ? run.stages : [];
  const rules = stages.find((stage: { name: string }) => stage.name === 'rules');
  const model = stages.find((stage: { name: string }) => stage.name === 'model');
  const degraded = stages.flatMap((stage: { failures?: Array<{ node_id: string; reason: string }> }) => stage.failures ?? []);
  const lines = [
    `# Amendeor — ${summary.chapters ?? 0} chapters, ${summary.scenes ?? 0} scenes, ${summary.words ?? 0} words, ${summary.language ?? '?'}`,
    '', `Rules: ${rules?.hits ?? 0} hits → ${rules?.proposals ?? 0} proposals (${rules?.units?.cached ?? 0} cached, ${rules?.units?.computed ?? 0} computed)`,
    `Model: ${model && model.status !== 'skipped' ? `${model.windows ?? 0} windows · ${model.no_change ?? 0} NO_CHANGE · ${model.candidates ?? 0} candidates` : 'rules only'}`,
    `Semantic guard: ${run.guard?.semantic_rejected ?? 0} rejected · Voice guard: ${run.guard?.voice_rejected ?? 0} rejected`,
    `Proposals: mechanical ${run.counts?.by_impact?.mechanical ?? 0} · prose ${run.counts?.by_impact?.prose ?? 0} (accepted ${run.decisions?.accepted ?? 0}, stale ${run.decisions?.stale ?? 0})`,
    `Findings: ${run.findings?.read ?? 0} read · ${run.findings?.applicable ?? 0} applicable`,
    `Usage: ${run.ledger?.tokens_in ?? 0}/${run.ledger?.tokens_out ?? 0} tokens · ${run.ledger?.cost === null ? 'unpriced' : run.ledger?.cost ?? 0} ${run.ledger?.currency ?? ''}`,
    `Pack: ${summary.pack?.status ?? '?'} (${summary.pack?.version ?? '?'})`,
    `Hotspots: ${summary.hotspots ?? 0}`,
    `Formulaic passages: ${Array.isArray(summary.formulaic) ? summary.formulaic.length : 0}`, '', '## Formulaic evidence', ''
  ];
  if (Array.isArray(summary.formulaic) && summary.formulaic.length) for (const hit of summary.formulaic) lines.push(`- ${hit.chapter}/${hit.scene} ${hit.id} [${hit.language}]: ${JSON.stringify(hit.quote)} (${hit.provenance})`);
  else lines.push('none');
  lines.push('', '## Degraded', '');
  if (degraded.length) lines.push(...degraded.map((item: { node_id: string; reason: string }) => `- ${item.node_id}: ${item.reason}`));
  else lines.push('none');
  for (const stage of stages) for (const item of stage.diagnostics ?? []) lines.push(`- diagnostic ${item.node_id}: ${item.message}`);
  for (const item of run.guard?.rejections ?? []) lines.push(`- rejected ${item.proposal_id} by ${item.guard}: ${item.reason}`);
  if (run.guard?.same_family_warning) lines.push('- warning: editor and verifier use the same model family');
  for (const warning of run.warnings ?? []) lines.push(`- warning: ${warning}`);
  return `${lines.join('\n')}\n`;
}

export async function currentDecisionStatus(source: OpenedSource): Promise<{ accepted: number; stale: number }> {
  const accepted = await readAccepted(source.editedDir);
  let stale = 0;
  for (const { proposal } of accepted) {
    const chapter = source.book.chapters.find((item) => item.slug === proposal.location.chapter);
    const scene = chapter?.scenes.find((item) => item.id === proposal.location.scene);
    if (!scene || 'stale' in locate(scene.text, proposal.target)) stale++;
  }
  return { accepted: accepted.length, stale };
}
