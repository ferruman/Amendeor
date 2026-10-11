import type { OpenedSource } from '../source/index.ts';
import type { Config, LoadedConfig } from '../config.ts';
import type { LanguagePack, LoadedPack } from '../lang/pack.ts';
import type { Proposal } from '../proposal/schema.ts';
import { proposalSchema } from '../proposal/schema.ts';
import { isExternalFinding } from '../findings/intake.ts';
import { Cache } from '../cache.ts';
import { Gateway } from '../provider/gateway.ts';
import { locate } from '../proposal/locate.ts';
import { dialogueSpans, editInDialogue } from '../text/dialogue.ts';
import { commaOnlyChange, semanticTrap, typoReviewable, typoShaped } from './traps.ts';
import { verifyMeaning, verifyObjectiveCorrection, type VerifyResult } from './verify.ts';
import { SpendRefused } from '../provider/meter.ts';
import { normalizationConfigured, voiceGuard } from './voice.ts';
import { TITLE_SCENE_ID, type Book } from '../book.ts';
import { properNouns } from '../text/names.ts';
import { changedSpan, spansTouch, touchesProtectedForm } from '../text/segment.ts';

// Правила, чья правка исправляет объективный дефект без перестановки слов: модельная правка тех же знаков уступает им.
export const preferredRules = ['rule:repetition.doubled-word'];

// Все бесплатные проверки в порядке исполнения; eval вызывает ту же функцию, а не копию условий.
// review: ловушка сработала на правке формы опечатки (traps.ts typoReviewable) — для старых вызовов это по-прежнему отказ
// (есть guard), guardProposals превращает её в находку на проверку.
export function deterministicGuard(proposal: Proposal, sceneText: string, book: Book, pack: LanguagePack, config: Config, mode = 'copy', ruleProposals: Proposal[] = [], bookNames = properNouns(book, pack)): { guard: 'semantic-trap' | 'voice' | 'rule-preferred'; reason: string; review?: true } | { found: { start: number; end: number }; commaCandidate: boolean; dialogue: boolean } {
  const found = locate(sceneText, proposal.target);
  if (!('ok' in found)) return { guard: 'semantic-trap', reason: 'target stale' };
  // Защищённая форма профиля сохранения: изменённая часть правки не может её задевать — ни у одного прохода редактора.
  if (touchesProtectedForm(sceneText, found.start, found.end, proposal.replacement, config.editorial_profile?.protected_forms ?? [])) return { guard: 'semantic-trap', reason: 'protected-form' };
  // Модель, правящая те же знаки, что и действующее правило-дубль, может переставить слова («и снова вышел»); правило — нет.
  const changed = changedSpan(sceneText, found.start, found.end, proposal.replacement);
  const rule = proposal.source === 'model' && ruleProposals.find((item) => preferredRules.includes(item.source) && item.location.chapter === proposal.location.chapter && item.location.scene === proposal.location.scene
    && ((at) => 'ok' in at && spansTouch(changed, changedSpan(sceneText, at.start, at.end, item.replacement)))(locate(sceneText, item.target)));
  if (rule) return { guard: 'rule-preferred', reason: `${rule.source} ${rule.id}` };
  const dialogue = editInDialogue(dialogueSpans(sceneText, pack), sceneText, found.start, found.end, proposal.replacement);
  const commaCandidate = mode === 'proofread' && proposal.category === 'punctuation' && commaOnlyChange(proposal.target.text, proposal.replacement);
  const trapOptions = { category: proposal.category, inDialogue: dialogue, modelGenerated: proposal.source === 'model', allowCommaCorrection: commaCandidate, dialogueTypoAuthorized: normalizationConfigured(config), nameContext: { prefix: sceneText.slice(0, found.start), bookNames } };
  const trap = semanticTrap(proposal.target.text, proposal.replacement, pack, trapOptions);
  if (trap) {
    // Реплика неприкосновенна для голоса (dialogue-*), но не для опечатки; прочие проверки голоса действуют и здесь.
    const voice = proposal.source === 'model' && typoReviewable(trap, proposal.target.text, proposal.replacement, pack, trapOptions) ? voiceGuard(proposal, sceneText, book, pack, config) : 'not-reviewable';
    const reviewable = !voice || voice.startsWith('dialogue-');
    return { guard: 'semantic-trap', reason: trap, ...(reviewable ? { review: true as const } : {}) };
  }
  // Голос — детерминированная проверка без побочных эффектов: она идёт до платных verifier, чтобы не платить за заведомо отклонённую правку.
  const voice = voiceGuard(proposal, sceneText, book, pack, config);
  if (voice) return { guard: 'voice', reason: voice };
  return { found, commaCandidate, dialogue };
}

// Структурный контекст для verifier — только то, что пайплайн знает надёжно. Вне кавычек — не значит «нейтральный рассказчик»:
// несобственно-прямая речь и стилизация бывают и там, поэтому голос повествования помечен как неизвестный.
export interface EditorialContext {
  location: { inside_quotes_or_dialogue_line: boolean; paragraph_contains_quotes_or_dialogue_lines: boolean; narrative_voice: 'unknown' };
  edit: { editor_category: string; category_source: 'editor, self-reported'; editor_passes: string[] };
  preservation: { configured: false } | { configured: true; historical_orthography: boolean; period_grammar: boolean; dialect: boolean; authorial_repetition: boolean; protected_forms: number };
}
export function editorialContext(proposal: Proposal, insideQuotes: boolean, paragraphHasQuotes: boolean, config: Config): EditorialContext {
  const profile = config.editorial_profile;
  return {
    location: { inside_quotes_or_dialogue_line: insideQuotes, paragraph_contains_quotes_or_dialogue_lines: paragraphHasQuotes, narrative_voice: 'unknown' },
    edit: { editor_category: proposal.category, category_source: 'editor, self-reported', editor_passes: proposal.passes ?? ['standard'] },
    preservation: profile ? { configured: true, historical_orthography: Boolean(profile.preservation.historical_orthography), period_grammar: Boolean(profile.preservation.period_grammar),
      dialect: Boolean(profile.preservation.dialect), authorial_repetition: Boolean(profile.preservation.authorial_repetition), protected_forms: profile.protected_forms.length } : { configured: false }
  };
}

export interface GuardRejection { proposal_id: string; guard: 'semantic-trap' | 'semantic-verifier' | 'objective-verifier' | 'punctuation-verifier' | 'voice' | 'rule-preferred' | 'merge-conflict'; reason: string; target?: string; replacement?: string; category?: string; chapter?: string; scene?: string; occurrence?: number; source?: string }
// Проверка не состоялась: verifier ответил не по схеме дважды, вызов не дошёл, или трату отказали — правка не проверена, а не отклонена.
export interface GuardFailure { proposal_id: string; node_id: string; kind: 'verifier' | 'provider' | 'spend-refused'; reason: string; review_only: boolean; target?: string; replacement?: string; category?: string; chapter?: string; scene?: string; occurrence?: number; source?: string }

// Правка формы опечатки, которую остановил фильтр, остаётся видна автору (AUDIT F2): только поштучно и с явным согласием —
// unverified, impact prose (не пакетная, не auto_accept, не под делегированием), с основанием в review.evidence.
function reviewOnly(proposal: Proposal, evidence: Record<string, string | number>, verification?: Pick<VerifyResult, 'passes' | 'agreed'>): Proposal {
  return proposalSchema.parse({ ...proposal, impact: 'prose', unverified: true, verification: { passes: verification?.passes ?? 0, agreed: verification?.agreed ?? 0, semantic_risk: 'unknown', voice: 'unknown' },
    review: { evidence: { shape: 'typo', ...evidence } } });
}

export async function guardProposals(source: OpenedSource, loaded: LoadedConfig, pack: LoadedPack, candidates: Proposal[], noCache = false, mode = 'copy', ruleProposals: Proposal[] = []): Promise<{ proposals: Proposal[]; rejected: GuardRejection[]; failures: GuardFailure[]; stage: Record<string, unknown>; ledger: Gateway['ledger'] }> {
  const cache = new Cache(source.stateDir, noCache); const gateway = new Gateway(loaded.config, pack.pack);
  const proposals: Proposal[] = []; const rejected: GuardRejection[] = []; const failures: GuardFailure[] = []; let semanticRejected = 0, ruleRejected = 0, objectiveRejected = 0, punctuationRejected = 0, voiceRejected = 0, review = 0; let sameFamily = false;
  const verifications: Array<Record<string, unknown>> = [];
  const bookNames = properNouns(source.book, pack.pack);
  let refused: string | undefined;
  for (const proposal of candidates) {
    // Текст отклонённой правки остаётся в rejected.jsonl: без него отказ фильтра нельзя разобрать после прогона.
    const edit = { target: proposal.target.text, replacement: proposal.replacement, category: proposal.category, chapter: proposal.location.chapter, scene: proposal.location.scene, occurrence: proposal.target.occurrence, source: proposal.source };
    const chapter = source.book.chapters.find((item) => item.slug === proposal.location.chapter);
    const node_id = `${proposal.location.chapter}/${proposal.location.scene}`;
    // Трату отказали: ни одна следующая правка не проверяется и не предлагается, но её текст сохраняется.
    if (refused) { failures.push({ proposal_id: proposal.id, node_id, kind: 'spend-refused', reason: refused, review_only: false, ...edit }); continue; }
    const scene = proposal.location.scene === TITLE_SCENE_ID && chapter
      ? { text: chapter.title }
      : chapter?.scenes.find((item) => item.id === proposal.location.scene);
    if (!scene) { rejected.push({ proposal_id: proposal.id, guard: 'semantic-trap', reason: 'scene missing', ...edit }); semanticRejected++; continue; }
    const check = deterministicGuard(proposal, scene.text, source.book, pack.pack, loaded.config, mode, ruleProposals, bookNames);
    if ('review' in check) { proposals.push(reviewOnly(proposal, { rejected_by: check.guard, reason: check.reason })); review++; continue; }
    if ('guard' in check) {
      rejected.push({ proposal_id: proposal.id, ...check, ...edit });
      if (check.guard === 'voice') voiceRejected++; else if (check.guard === 'rule-preferred') ruleRejected++; else semanticRejected++;
      continue;
    }
    const { found, commaCandidate } = check;
    const contextStart = scene.text.lastIndexOf('\n\n', found.start) + 2;
    const contextEndIndex = scene.text.indexOf('\n\n', found.end);
    const context = scene.text.slice(contextStart, contextEndIndex < 0 ? scene.text.length : contextEndIndex);
    // Сбой проверки — не отказ: правка формы опечатки становится находкой на проверку, прочая записывается как непроверенная.
    const failed = (kind: 'verifier' | 'provider', reason: string, verification?: Pick<VerifyResult, 'passes' | 'agreed'>) => {
      const recover = typoShaped(proposal.target.text, proposal.replacement);
      failures.push({ proposal_id: proposal.id, node_id, kind, reason, review_only: recover, ...edit });
      if (recover) { proposals.push(reviewOnly(proposal, { unchecked: `${kind} failure`, reason: reason.split('\n')[0]!.slice(0, 200) }, verification)); review++; }
    };
    if (mode === 'proofread') {
      let objective: Awaited<ReturnType<typeof verifyObjectiveCorrection>>;
      try { objective = await verifyObjectiveCorrection(proposal.target.text, proposal.replacement, context, proposal.category, loaded.config, cache, gateway); }
      catch (error) { if (!(error instanceof SpendRefused)) throw error; refused = error.message; failures.push({ proposal_id: proposal.id, node_id, kind: 'spend-refused', reason: refused, review_only: false, ...edit }); continue; }
      if (objective.failure) { failed(objective.failure, objective.reason); continue; }
      if (!objective.passed) {
        rejected.push({ proposal_id: proposal.id, guard: commaCandidate ? 'punctuation-verifier' : 'objective-verifier', reason: objective.reason, ...edit });
        if (commaCandidate) punctuationRejected++; else objectiveRejected++;
        continue;
      }
    }
    // В proofread необходимость уже проверил verifyObjectiveCorrection; в copy её проверяет verifyMeaning, если так настроено.
    const evidenceBacked = proposal.category === 'prose-pattern' && Boolean(proposal.source_findings?.some(isExternalFinding));
    const necessity = !evidenceBacked && mode === 'copy' && loaded.config.profiles.verify?.check === 'necessity';
    let verification: VerifyResult;
    try {
      verification = await verifyMeaning(proposal.target.text, proposal.replacement, context, proposal.impact, loaded.config, pack.pack, cache, gateway,
        { necessity, minPasses: evidenceBacked ? 3 : undefined, context: necessity && loaded.config.profiles.verify?.context ? editorialContext(proposal, check.dialogue, dialogueSpans(context, pack.pack).length > 0, loaded.config) : undefined });
    } catch (error) { if (!(error instanceof SpendRefused)) throw error; refused = error.message; failures.push({ proposal_id: proposal.id, node_id, kind: 'spend-refused', reason: refused, review_only: false, ...edit }); continue; }
    verifications.push({ proposal_id: proposal.id, ...verification });
    sameFamily ||= verification.sameFamily;
    if (verification.failure) { failed(verification.failure, verification.reason, verification); continue; }
    if (!verification.passed) {
      // Решающий ответ — последний. Отказ окончателен, только если verifier не видит ни ошибки, ни сохранённого смысла
      // (necessary: false и preserved: false). Иначе правка формы опечатки — находка на проверку: «поедет я» → «поеду я».
      const last = verification.answers?.at(-1);
      if (necessity && last && (last.necessary || last.preserved) && typoShaped(proposal.target.text, proposal.replacement)) {
        proposals.push(reviewOnly(proposal, { rejected_by: 'semantic-verifier', reason: verification.reason.slice(0, 300) }, verification)); review++; continue;
      }
      rejected.push({ proposal_id: proposal.id, guard: 'semantic-verifier', reason: verification.reason, ...edit }); semanticRejected++; continue;
    }
    const verified = { ...proposal, verification: { passes: verification.passes, agreed: verification.agreed, semantic_risk: 'none', voice: 'ok' } };
    if (evidenceBacked) {
      // Смысл проверен, но литературную пользу решает автор по каждому id через существующий явный consent.
      verified.unverified = true;
      Object.assign(verified, { review: { evidence: { shape: 'repetition', meaning: 'preserved', approval: 'explicit author decision required' } } });
      review++;
    } else delete (verified as Partial<Proposal>).unverified;
    proposals.push(proposalSchema.parse(verified));
  }
  // Отказ фильтра — нормальный исход проверки; partial — только когда проверка не состоялась.
  const count = (kind: GuardFailure['kind']) => failures.filter((item) => item.kind === kind).length;
  return { proposals, rejected, failures, stage: { name: 'guard', status: refused ? 'refused' : failures.length ? 'partial' : 'ok', candidates: candidates.length, semantic_rejected: semanticRejected, rule_preferred: ruleRejected, objective_rejected: objectiveRejected, punctuation_rejected: punctuationRejected, voice_rejected: voiceRejected,
    offered: proposals.length - review, review_only: review, rejected: rejected.length, verifier_failures: count('verifier'), provider_failures: count('provider'), spend_refused: count('spend-refused'), same_family_warning: sameFamily, rejections: rejected, failures, verifications }, ledger: gateway.ledger };
}
