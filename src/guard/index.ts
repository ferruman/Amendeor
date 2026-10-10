import type { OpenedSource } from '../source/index.ts';
import type { Config, LoadedConfig } from '../config.ts';
import type { LanguagePack, LoadedPack } from '../lang/pack.ts';
import type { Proposal } from '../proposal/schema.ts';
import { proposalSchema } from '../proposal/schema.ts';
import { Cache } from '../cache.ts';
import { Gateway } from '../provider/gateway.ts';
import { locate } from '../proposal/locate.ts';
import { dialogueSpans, editInDialogue } from '../text/dialogue.ts';
import { commaOnlyChange, semanticTrap } from './traps.ts';
import { verifyMeaning, verifyObjectiveCorrection } from './verify.ts';
import { normalizationConfigured, voiceGuard } from './voice.ts';
import { TITLE_SCENE_ID, type Book } from '../book.ts';
import { properNouns } from '../text/names.ts';
import { changedSpan, spansTouch } from '../text/segment.ts';

// Правила, чья правка исправляет объективный дефект без перестановки слов: модельная правка тех же знаков уступает им.
export const preferredRules = ['rule:repetition.doubled-word'];

// Все бесплатные проверки в порядке исполнения; eval вызывает ту же функцию, а не копию условий.
export function deterministicGuard(proposal: Proposal, sceneText: string, book: Book, pack: LanguagePack, config: Config, mode = 'copy', ruleProposals: Proposal[] = [], bookNames = properNouns(book, pack)): { guard: 'semantic-trap' | 'voice' | 'rule-preferred'; reason: string } | { found: { start: number; end: number }; commaCandidate: boolean } {
  const found = locate(sceneText, proposal.target);
  if (!('ok' in found)) return { guard: 'semantic-trap', reason: 'target stale' };
  // Модель, правящая те же знаки, что и действующее правило-дубль, может переставить слова («и снова вышел»); правило — нет.
  const changed = changedSpan(sceneText, found.start, found.end, proposal.replacement);
  const rule = proposal.source === 'model' && ruleProposals.find((item) => preferredRules.includes(item.source) && item.location.chapter === proposal.location.chapter && item.location.scene === proposal.location.scene
    && ((at) => 'ok' in at && spansTouch(changed, changedSpan(sceneText, at.start, at.end, item.replacement)))(locate(sceneText, item.target)));
  if (rule) return { guard: 'rule-preferred', reason: `${rule.source} ${rule.id}` };
  const dialogue = editInDialogue(dialogueSpans(sceneText, pack), sceneText, found.start, found.end, proposal.replacement);
  const commaCandidate = mode === 'proofread' && proposal.category === 'punctuation' && commaOnlyChange(proposal.target.text, proposal.replacement);
  const trap = semanticTrap(proposal.target.text, proposal.replacement, pack, { category: proposal.category, inDialogue: dialogue, modelGenerated: proposal.source === 'model', allowCommaCorrection: commaCandidate, dialogueTypoAuthorized: normalizationConfigured(config), nameContext: { prefix: sceneText.slice(0, found.start), bookNames } });
  if (trap) return { guard: 'semantic-trap', reason: trap };
  // Голос — детерминированная проверка без побочных эффектов: она идёт до платных verifier, чтобы не платить за заведомо отклонённую правку.
  const voice = voiceGuard(proposal, sceneText, book, pack, config);
  if (voice) return { guard: 'voice', reason: voice };
  return { found, commaCandidate };
}

export interface GuardRejection { proposal_id: string; guard: 'semantic-trap' | 'semantic-verifier' | 'objective-verifier' | 'punctuation-verifier' | 'voice' | 'rule-preferred'; reason: string; target?: string; replacement?: string; category?: string; chapter?: string; scene?: string; occurrence?: number; source?: string }
export async function guardProposals(source: OpenedSource, loaded: LoadedConfig, pack: LoadedPack, candidates: Proposal[], noCache = false, mode = 'copy', ruleProposals: Proposal[] = []): Promise<{ proposals: Proposal[]; rejected: GuardRejection[]; stage: Record<string, unknown>; ledger: Gateway['ledger'] }> {
  const cache = new Cache(source.stateDir, noCache); const gateway = new Gateway(loaded.config, pack.pack);
  const proposals: Proposal[] = []; const rejected: GuardRejection[] = []; let semanticRejected = 0, ruleRejected = 0, objectiveRejected = 0, punctuationRejected = 0, voiceRejected = 0; let sameFamily = false;
  const bookNames = properNouns(source.book, pack.pack);
  for (const proposal of candidates) {
    // Текст отклонённой правки остаётся в rejected.jsonl: без него отказ фильтра нельзя разобрать после прогона.
    const edit = { target: proposal.target.text, replacement: proposal.replacement, category: proposal.category, chapter: proposal.location.chapter, scene: proposal.location.scene, occurrence: proposal.target.occurrence, source: proposal.source };
    const chapter = source.book.chapters.find((item) => item.slug === proposal.location.chapter);
    const scene = proposal.location.scene === TITLE_SCENE_ID && chapter
      ? { text: chapter.title }
      : chapter?.scenes.find((item) => item.id === proposal.location.scene);
    if (!scene) { rejected.push({ proposal_id: proposal.id, guard: 'semantic-trap', reason: 'scene missing', ...edit }); semanticRejected++; continue; }
    const check = deterministicGuard(proposal, scene.text, source.book, pack.pack, loaded.config, mode, ruleProposals, bookNames);
    if ('guard' in check) {
      rejected.push({ proposal_id: proposal.id, ...check, ...edit });
      if (check.guard === 'voice') voiceRejected++; else if (check.guard === 'rule-preferred') ruleRejected++; else semanticRejected++;
      continue;
    }
    const { found, commaCandidate } = check;
    const contextStart = scene.text.lastIndexOf('\n\n', found.start) + 2;
    const contextEndIndex = scene.text.indexOf('\n\n', found.end);
    const context = scene.text.slice(contextStart, contextEndIndex < 0 ? scene.text.length : contextEndIndex);
    if (mode === 'proofread') {
      const objective = await verifyObjectiveCorrection(proposal.target.text, proposal.replacement, context, proposal.category, loaded.config, cache, gateway);
      if (!objective.passed) {
        rejected.push({ proposal_id: proposal.id, guard: commaCandidate ? 'punctuation-verifier' : 'objective-verifier', reason: objective.reason, ...edit });
        if (commaCandidate) punctuationRejected++; else objectiveRejected++;
        continue;
      }
    }
    // В proofread необходимость уже проверил verifyObjectiveCorrection; в copy её проверяет verifyMeaning, если так настроено.
    const verification = await verifyMeaning(proposal.target.text, proposal.replacement, context, proposal.impact, loaded.config, pack.pack, cache, gateway, { necessity: mode === 'copy' && loaded.config.profiles.verify?.check === 'necessity' });
    sameFamily ||= verification.sameFamily;
    if (!verification.passed) { rejected.push({ proposal_id: proposal.id, guard: 'semantic-verifier', reason: verification.reason, ...edit }); semanticRejected++; continue; }
    const verified = { ...proposal, verification: { passes: verification.passes, agreed: verification.agreed, semantic_risk: 'none', voice: 'ok' } };
    delete (verified as Partial<Proposal>).unverified;
    proposals.push(proposalSchema.parse(verified));
  }
  return { proposals, rejected, stage: { name: 'guard', status: rejected.length ? 'partial' : 'ok', candidates: candidates.length, semantic_rejected: semanticRejected, rule_preferred: ruleRejected, objective_rejected: objectiveRejected, punctuation_rejected: punctuationRejected, voice_rejected: voiceRejected, offered: proposals.length, same_family_warning: sameFamily, rejections: rejected }, ledger: gateway.ledger };
}
