import type { OpenedSource } from './source/index.ts';
import { readRun } from './run/store.ts';
import { readAccepted } from './edited/decisions.ts';
import { locate } from './proposal/locate.ts';
import { TITLE_SCENE_ID } from './book.ts';

export type ProposalChange = 'new' | 'unchanged' | 'updated' | 'resolved' | 'stale';
export interface DiffEntry { id: string; state: ProposalChange }

export async function diffRuns(source: OpenedSource): Promise<{ previous_run_id: string | null; latest_run_id: string; changes: DiffEntry[] }> {
  const latest = await readRun(source.stateDir, 'latest');
  const latestManifest = latest.run as { run_id?: string; baseline?: { previous_run_id?: string | null } };
  const previousId = latestManifest.baseline?.previous_run_id ?? null;
  const previous = previousId ? await readRun(source.stateDir, previousId) : null;
  const current = new Map(latest.proposals.map((proposal) => [proposal.id, proposal]));
  const prior = new Map(previous?.proposals.map((proposal) => [proposal.id, proposal]) ?? []);
  const changes: DiffEntry[] = [];
  for (const [id, proposal] of current) {
    const old = prior.get(id);
    changes.push({ id, state: !old ? 'new' : old.fingerprint.evidence === proposal.fingerprint.evidence ? 'unchanged' : 'updated' });
  }
  for (const id of prior.keys()) if (!current.has(id)) changes.push({ id, state: 'resolved' });
  for (const { proposal } of await readAccepted(source.editedDir)) {
    const chapter = source.book.chapters.find((item) => item.slug === proposal.location.chapter);
    const text = proposal.location.scene === TITLE_SCENE_ID ? chapter?.title : chapter?.scenes.find((item) => item.id === proposal.location.scene)?.text;
    if (text === undefined || 'stale' in locate(text, proposal.target)) changes.push({ id: proposal.id, state: 'stale' });
  }
  return { previous_run_id: previousId, latest_run_id: latestManifest.run_id ?? '', changes };
}
