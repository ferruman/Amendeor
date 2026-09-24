import type { LanguagePack } from '../lang/pack.ts';
import type { Config } from '../config.ts';
import type { FormulaicHit } from '../patterns/formulaic.ts';

export const copyEditPromptVersion = '1.2.0';
export function copyEditPrompt(pack: LanguagePack, editable: string, before: string, after: string, mode: string, config?: Config, retryError?: string, formulaic: FormulaicHit[] = []): { system: string; prompt: string } {
  const language = pack.language === 'ru' ? 'Write reasons in Russian. Preserve Russian spelling and authorial dialogue register.' : 'Write reasons in English. Preserve English spelling and authorial dialogue register.';
  const system = [
    'You are a conservative literary copy editor.',
    language,
    'Suggest the smallest local correction and preserve facts, uncertainty, characterization and voice.',
    'Never invent details or normalize intentionally unusual prose.',
    'Most windows need no changes. Return {"edits":[]} for NO_CHANGE.',
    'Edit only an objective error you can name; if the rule or intended meaning is uncertain, return NO_CHANGE.',
    'Do not standardize ellipses, expressive punctuation, or period style.',
    pack.language === 'ru' ? 'Do not insert a comma between homogeneous predicates joined by и when they share one subject.' : '',
    'Return JSON only: {"edits":[{"target":"exact verbatim text","replacement":"replacement","category":"category","reason":"brief reason"}]}.',
    'Categories: spelling, grammar, punctuation, typography, capitalization, word-choice, clarity, sentence-structure, redundancy, repetition, dialogue-mechanics, terminology, consistency, prose-pattern.',
    'Every target must occur verbatim in EDITABLE TEXT and each edit must stay within one paragraph.',
    'Text before and after EDITABLE TEXT is read-only context.',
    config?.preserve.length ? 'Preserve: ' + config.preserve.join(', ') + '.' : '',
    config?.avoid.length ? 'Avoid: ' + config.avoid.join(', ') + '.' : '',
    config ? 'Normalize only as configured: ' + JSON.stringify(config.normalize) + '.' : '',
    mode === 'mechanical' ? 'Only correct grammar and spelling in this pass.' : 'Suggest copy edits only when the gain is clear.',
    formulaic.length ? 'For formulaic signals, propose one minimal local prose-pattern edit or NO_CHANGE. Never invent specificity, erase uncertainty or normalize the author’s voice.' : ''
  ].filter(Boolean).join('\n');
  const prompt = ['READ-ONLY BEFORE:', before, 'EDITABLE TEXT:', editable, 'READ-ONLY AFTER:', after,
    ...(formulaic.length ? ['FORMULAIC SIGNALS (evidence, not authorship):', formulaic.map((hit) => hit.id + ': ' + JSON.stringify(hit.quote)).join('\n')] : []),
    ...(retryError ? ['PREVIOUS OUTPUT ERROR:', retryError, 'Return valid JSON with exact targets.'] : [])].join('\n\n');
  return { system, prompt };
}
