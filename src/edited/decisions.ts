import { appendFile, readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { proposalSchema, type Proposal } from '../proposal/schema.ts';

// accepted_by — кто принял (DELEGATION.md §1); authority/authorized_by/delegation_id — когда это агент под делегированием.
export interface Acceptance { proposal: Proposal; accepted_by: string; at: string; authority?: 'direct' | 'delegated'; authorized_by?: string; delegation_id?: string }
export interface Rejection { proposal_id: string; target_hash: string; rejected_by: string; at: string }
export class DecisionError extends Error {
  readonly code: 'unverified-proposal' | 'duplicate-proposal-id' | 'conflicting-acceptance' | 'proposal-not-found';
  constructor(code: 'unverified-proposal' | 'duplicate-proposal-id' | 'conflicting-acceptance' | 'proposal-not-found', message: string) { super(`${code}: ${message}`); this.code = code; }
}

// Тот же id уже принят с другой заменой: журнал только дописывается, поэтому такое принятие невозможно.
export function conflictsWithAccepted(accepted: Acceptance[], proposal: Proposal): boolean {
  const prior = accepted.find((record) => record.proposal.id === proposal.id);
  return Boolean(prior && (prior.proposal.fingerprint.evidence !== proposal.fingerprint.evidence || prior.proposal.replacement !== proposal.replacement));
}

export async function readAccepted(editedDir: string): Promise<Acceptance[]> {
  const file = path.join(editedDir, 'accepted.jsonl');
  let contents: string;
  try { contents = await readFile(file, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const result: Acceptance[] = [];
  for (const [index, line] of contents.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let item: Acceptance;
    try { const parsed = JSON.parse(line) as Acceptance; item = { ...parsed, proposal: proposalSchema.parse(parsed.proposal) }; }
    catch (error) { throw new Error(`invalid acceptance line ${index + 1}: ${(error as Error).message}`); }
    if (conflictsWithAccepted(result, item.proposal)) throw new DecisionError('conflicting-acceptance', item.proposal.id);
    if (!result.some((record) => record.proposal.id === item.proposal.id)) result.push(item);
  }
  return result;
}

// acceptedBy обязателен: принятие всегда записывается за тем, кто его сделал, — без молчаливого «author».
export async function acceptProposals(editedDir: string, proposals: Proposal[], options: { acceptedBy: string; allowUnverified?: boolean; provenance?: Pick<Acceptance, 'authority' | 'authorized_by' | 'delegation_id'> }): Promise<Acceptance[]> {
  if (!options?.acceptedBy) throw new Error('acceptProposals needs the actor (acceptedBy)');
  const accepted = await readAccepted(editedDir);
  const seen = new Set<string>();
  for (const proposal of proposals) {
    proposalSchema.parse(proposal);
    if (seen.has(proposal.id)) throw new DecisionError('duplicate-proposal-id', proposal.id);
    seen.add(proposal.id);
    if (proposal.unverified && !options.allowUnverified) throw new DecisionError('unverified-proposal', proposal.id);
    if (conflictsWithAccepted(accepted, proposal)) throw new DecisionError('conflicting-acceptance', proposal.id);
  }
  const fresh = proposals.filter((proposal) => !accepted.some((record) => record.proposal.id === proposal.id));
  const at = new Date().toISOString();
  const records: Acceptance[] = fresh.map((proposal) => ({ proposal, accepted_by: options.acceptedBy, ...options.provenance, at }));
  if (fresh.length) {
    await mkdir(editedDir, { recursive: true });
    await appendFile(path.join(editedDir, 'accepted.jsonl'), records.map((record) => JSON.stringify(record)).join('\n') + '\n');
  }
  return [...accepted, ...records];
}

export async function rejectProposals(stateDir: string, proposals: Proposal[], rejectedBy = 'author'): Promise<void> {
  await mkdir(stateDir, { recursive: true });
  await appendFile(path.join(stateDir, 'rejected-by-author.jsonl'), proposals.map((proposal) => JSON.stringify({ proposal_id: proposal.id, target_hash: proposal.target.hash, rejected_by: rejectedBy, at: new Date().toISOString() })).join('\n') + '\n');
}

export async function readRejected(stateDir: string): Promise<Rejection[]> {
  const file = path.join(stateDir, 'rejected-by-author.jsonl');
  let contents: string;
  try { contents = await readFile(file, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  return contents.split(/\r?\n/).flatMap((line, index) => {
    if (!line.trim()) return [];
    try {
      const item = JSON.parse(line) as Rejection;
      if (typeof item.proposal_id !== 'string' || typeof item.target_hash !== 'string' || typeof item.rejected_by !== 'string' || typeof item.at !== 'string') throw new Error('missing rejection fields');
      return [item];
    } catch (error) { throw new Error(`invalid rejection line ${index + 1}: ${(error as Error).message}`); }
  });
}
