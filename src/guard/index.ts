import type { OpenedSource } from '../source/index.ts';
import type { LoadedConfig } from '../config.ts';
import type { LoadedPack } from '../lang/pack.ts';
import type { Proposal } from '../proposal/schema.ts';
import { proposalSchema } from '../proposal/schema.ts';
import { Cache } from '../cache.ts';
import { Gateway } from '../provider/gateway.ts';
import { locate } from '../proposal/locate.ts';
import { dialogueSpans, inDialogue } from '../text/dialogue.ts';
import { semanticTrap } from './traps.ts';
import { verifyMeaning } from './verify.ts';
import { voiceGuard } from './voice.ts';
import { TITLE_SCENE_ID } from '../book.ts';
import { commaOnlyChange } from './traps.ts';
import { verifyObjectiveCorrection } from './verify.ts';

export interface GuardRejection { proposal_id: string; guard: 'semantic-trap' | 'semantic-verifier' | 'objective-verifier' | 'punctuation-verifier' | 'voice'; reason: string }
export async function guardProposals(source: OpenedSource, loaded: LoadedConfig, pack: LoadedPack, candidates: Proposal[], noCache = false, mode = 'copy'): Promise<{ proposals: Proposal[]; rejected: GuardRejection[]; stage: Record<string, unknown>; ledger: Gateway['ledger'] }> {
  const cache = new Cache(source.stateDir, noCache); const gateway = new Gateway(loaded.config, pack.pack);
  const proposals: Proposal[] = []; const rejected: GuardRejection[] = []; let semanticRejected = 0, objectiveRejected = 0, punctuationRejected = 0, voiceRejected = 0; let sameFamily = false;
  for (const proposal of candidates) {
    const chapter = source.book.chapters.find((item) => item.slug === proposal.location.chapter);
    const scene = proposal.location.scene === TITLE_SCENE_ID && chapter
      ? { text: chapter.title }
      : chapter?.scenes.find((item) => item.id === proposal.location.scene);
    if (!scene) { rejected.push({ proposal_id: proposal.id, guard: 'semantic-trap', reason: 'scene missing' }); semanticRejected++; continue; }
    const found = locate(scene.text, proposal.target);
    if (!('ok' in found)) { rejected.push({ proposal_id: proposal.id, guard: 'semantic-trap', reason: 'target stale' }); semanticRejected++; continue; }
    const dialogue = inDialogue(dialogueSpans(scene.text, pack.pack), found.start, found.end);
    const commaCandidate = mode === 'proofread' && proposal.category === 'punctuation' && commaOnlyChange(proposal.target.text, proposal.replacement);
    const trap = semanticTrap(proposal.target.text, proposal.replacement, pack.pack, { category: proposal.category, inDialogue: dialogue, modelGenerated: proposal.source === 'model', allowCommaCorrection: commaCandidate });
    if (trap) { rejected.push({ proposal_id: proposal.id, guard: 'semantic-trap', reason: trap }); semanticRejected++; continue; }
    const contextStart = scene.text.lastIndexOf('\n\n', found.start) + 2;
    const contextEndIndex = scene.text.indexOf('\n\n', found.end);
    const context = scene.text.slice(contextStart, contextEndIndex < 0 ? scene.text.length : contextEndIndex);
    if (mode === 'proofread') {
      const objective = await verifyObjectiveCorrection(proposal.target.text, proposal.replacement, context, proposal.category, loaded.config, cache, gateway);
      if (!objective.passed) {
        rejected.push({ proposal_id: proposal.id, guard: commaCandidate ? 'punctuation-verifier' : 'objective-verifier', reason: objective.reason });
        if (commaCandidate) punctuationRejected++; else objectiveRejected++;
        continue;
      }
    }
    const verification = await verifyMeaning(proposal.target.text, proposal.replacement, context, proposal.impact, loaded.config, pack.pack, cache, gateway);
    sameFamily ||= verification.sameFamily;
    if (!verification.passed) { rejected.push({ proposal_id: proposal.id, guard: 'semantic-verifier', reason: verification.reason }); semanticRejected++; continue; }
    const voice = voiceGuard(proposal, scene.text, source.book, pack.pack, loaded.config);
    if (voice) { rejected.push({ proposal_id: proposal.id, guard: 'voice', reason: voice }); voiceRejected++; continue; }
    const verified = { ...proposal, verification: { passes: verification.passes, agreed: verification.agreed, semantic_risk: 'none', voice: 'ok' } };
    delete (verified as Partial<Proposal>).unverified;
    proposals.push(proposalSchema.parse(verified));
  }
  return { proposals, rejected, stage: { name: 'guard', status: rejected.length ? 'partial' : 'ok', candidates: candidates.length, semantic_rejected: semanticRejected, objective_rejected: objectiveRejected, punctuation_rejected: punctuationRejected, voice_rejected: voiceRejected, offered: proposals.length, same_family_warning: sameFamily, rejections: rejected }, ledger: gateway.ledger };
}
