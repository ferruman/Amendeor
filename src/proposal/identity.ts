import { sha256, canonicalJson, normalizeQuote } from '../hash.ts';
import { proposalSchema, type Proposal } from './schema.ts';
import { locate } from './locate.ts';

export type MakeProposalInput = {
  category: Proposal['category']; chapter: string; scene: string; target: string; replacement: string;
  before?: string; after?: string; occurrence?: number; run_id?: string; impact?: Proposal['impact'];
  source?: string; confidence?: number; reason?: string; content_hash?: string;
  verification?: Proposal['verification']; unverified?: true; source_findings?: string[]; sceneText?: string;
};

export function makeProposal(input: MakeProposalInput): Proposal {
  let before = input.before; let after = input.after; let occurrence = input.occurrence ?? 0;
  if (input.sceneText !== undefined && (before === undefined || after === undefined)) {
    const found = locate(input.sceneText, { text: input.target, occurrence });
    if ('ok' in found) {
      before ??= input.sceneText.slice(Math.max(0, found.start - 60), found.start);
      after ??= input.sceneText.slice(found.end, found.end + 60);
    }
  }
  const targetHash = sha256(normalizeQuote(input.target));
  const primary = { category: input.category, chapter: input.chapter, scene: input.scene, key: targetHash };
  const proposal = {
    schema: 'amendeor.proposal/0.1' as const,
    id: `amendeor:${sha256(canonicalJson(primary)).slice(7, 23)}`,
    fingerprint: { primary, evidence: sha256(normalizeQuote(input.replacement)) },
    run_id: input.run_id ?? 'manual', tool: { name: 'amendeor' as const, version: '0.1.0' },
    location: { chapter: input.chapter, scene: input.scene, content_hash: input.content_hash ?? sha256('') },
    target: { text: input.target, hash: targetHash, before: (before ?? '').slice(-60), after: (after ?? '').slice(0, 60), occurrence },
    replacement: input.replacement, category: input.category, impact: input.impact ?? 'prose', source: input.source ?? 'model',
    confidence: input.confidence ?? 1, reason: input.reason ?? '', ...(input.source_findings ? { source_findings: input.source_findings } : {}),
    verification: input.verification ?? { passes: 0, agreed: 0, semantic_risk: 'unknown', voice: 'unknown' },
    ...(input.unverified ? { unverified: true as const } : {})
  };
  return proposalSchema.parse(proposal);
}
