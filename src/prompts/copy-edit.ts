import type { LanguagePack } from '../lang/pack.ts';
import { effectivePreserve, type Config } from '../config.ts';
import type { FormulaicHit } from '../patterns/formulaic.ts';

export const copyEditPromptVersion = '1.6.0';
export function copyEditPrompt(pack: LanguagePack, editable: string, before: string, after: string, mode: string, config?: Config, retryError?: string, formulaic: FormulaicHit[] = [], title = false): { system: string; prompt: string } {
  const language = pack.language === 'ru' ? 'Write reasons in Russian. Preserve Russian spelling and authorial dialogue register.' : 'Write reasons in English. Preserve English spelling and authorial dialogue register.';
  const system = [
    'You are a conservative literary copy editor.',
    language,
    'Suggest the smallest local correction and preserve facts, uncertainty, characterization and voice.',
    'Never invent details or normalize intentionally unusual prose.',
    'Never lemmatize proper names, plurals, family names, weekdays or established phrases (Fridays, the Brandts, a Hail Mary). Terminology changes require an explicit author-supplied wrong variant; do not infer canonical terms from similar names.',
    'Most windows need no changes. Return {"edits":[]} for NO_CHANGE.',
    'Edit only an objective error you can name; if the rule or intended meaning is uncertain, return NO_CHANGE.',
    'Do not standardize ellipses, expressive punctuation, or period style.',
    pack.language === 'ru' ? 'Do not insert a comma between homogeneous predicates joined by и when they share one subject.' : '',
    'Return JSON only: {"edits":[{"target":"exact verbatim text","replacement":"replacement","category":"category","reason":"brief reason"}]}.',
    'Categories: spelling, grammar, punctuation, typography, capitalization, word-choice, clarity, sentence-structure, redundancy, repetition, dialogue-mechanics, terminology, consistency, prose-pattern.',
    `Every target must occur verbatim in ${title ? 'EDITABLE CHAPTER TITLE' : 'EDITABLE TEXT'} and each edit must stay within one paragraph.`,
    'Text before and after EDITABLE TEXT is read-only context.',
    config && effectivePreserve(config).length ? 'Preserve: ' + effectivePreserve(config).join(', ') + '.' : '',
    config?.avoid.length ? 'Avoid: ' + config.avoid.join(', ') + '.' : '',
    config ? 'Normalize only as configured: ' + JSON.stringify(config.normalize) + '.' : '',
    mode === 'mechanical' ? 'Only correct grammar and spelling in this pass.' : mode === 'proofread'
      ? 'Proofread the whole text for objective spelling, grammar and punctuation errors only. Check agreement and commas at clause boundaries carefully. Preserve historical spelling and partitive forms. Explain the specific rule behind each edit; do not suggest stylistic rewrites.'
      : 'Suggest copy edits only when the gain is clear.',
    title ? 'This is a chapter title. Preserve its wording and do not add terminal punctuation.' : '',
    formulaic.length ? 'For formulaic signals, propose one minimal local prose-pattern edit or NO_CHANGE. Never invent specificity, erase uncertainty or normalize the author’s voice.' : ''
  ].filter(Boolean).join('\n');
  const prompt = ['READ-ONLY BEFORE:', before, title ? 'EDITABLE CHAPTER TITLE:' : 'EDITABLE TEXT:', editable, 'READ-ONLY AFTER:', after,
    ...(formulaic.length ? ['FORMULAIC SIGNALS (evidence, not authorship):', formulaic.map((hit) => hit.id + ': ' + JSON.stringify(hit.quote) + ' (' + hit.reason + ')').join('\n')] : []),
    ...(retryError ? ['PREVIOUS OUTPUT ERROR:', retryError, 'Return valid JSON with exact targets.'] : [])].join('\n\n');
  return { system, prompt };
}

// Диагностический проход: тот же промпт copy-edit, где две строки о сдержанности заменены просьбой методично найти
// объективные ошибки. Все строки политики (имена, стиль, preserve, формат JSON, дословная цель) у проходов общие.
// Текст тот же, что в эксперименте по полноте 2026-10-10 (eval/bench/run.ts).
export const diagnosticPromptVersion = 'copy-edit-diagnostic-1.0.0';
const restraintLines = ['Most windows need no changes. Return {"edits":[]} for NO_CHANGE.', 'Suggest copy edits only when the gain is clear.'];
export function diagnosticEditPrompt(...args: Parameters<typeof copyEditPrompt>): { system: string; prompt: string } {
  const base = copyEditPrompt(...args);
  if (!restraintLines.every((line) => base.system.includes(line))) throw new Error('copy-edit prompt changed; the diagnostic prompt must be revised with it');
  return {
    system: base.system
      .replace(restraintLines[0]!, 'Diagnostic pass: read EDITABLE TEXT slowly, sentence by sentence and word by word, and report every OBJECTIVE error you find. Return {"edits":[]} only if there is none.')
      .replace(restraintLines[1]!, 'Objective errors: misspelled or transposed letters; broken agreement (subject–verb, gender, number); a wrong word form or case; an accidentally doubled or missing word; a phrase or sentence fragment repeated by mistake; a stock phrase that is plainly out of place and breaks the sentence; an unambiguous punctuation slip. Do not report style, rhythm, word choice, period or regional spelling, dialect or a character\'s speech.'),
    prompt: base.prompt
  };
}
