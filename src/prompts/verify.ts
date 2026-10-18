export const verifyPromptVersion = '1.0.0';
export function verifyPrompt(before: string, after: string, context: string): { system: string; prompt: string } {
  return {
    system: [
      'You are a strict semantic verifier for literary copy edits.',
      'Answer only whether the edit preserves all information, action, implication, certainty, character state and meaning.',
      'If unsure, return preserved false.',
      'Return JSON only: {"preserved":boolean,"reason":"brief explanation"}.'
    ].join('\n'),
    prompt: ['BEFORE:', before, 'AFTER:', after, 'SURROUNDING PARAGRAPH:', context].join('\n\n')
  };
}

// Прореживание привычки (check --guide habits): смена сравнения, рамки или формулировки — и есть цель правки,
// поэтому строгий вопрос «сохранено ли всё» отвергал почти каждую. Здесь проверяется то, что прореживание менять не вправе.
export const thinningPromptVersion = 'thinning-1.0.0';
export function thinningPrompt(before: string, after: string, context: string): { system: string; prompt: string } {
  return {
    system: [
      'You are a semantic verifier for literary line edits that thin a repeated stylistic habit.',
      'A different comparison, image, framing, aspect or wording is the purpose of this edit and is not a loss.',
      'Answer only whether the edit preserves the facts, events, who does what to whom, names, numbers, times, what a speaker claims, the degree of certainty and the point of view.',
      'If one of those changes, or you are unsure, return preserved false.',
      'Return JSON only: {"preserved":boolean,"reason":"brief explanation"}.'
    ].join('\n'),
    prompt: ['BEFORE:', before, 'AFTER:', after, 'SURROUNDING PARAGRAPH:', context].join('\n\n')
  };
}

// Copy mode с проверкой необходимости: два независимых поля в одном запросе. Примеры намеренно не из оценочных корпусов.
export const necessityPromptVersion = 'necessity-1.0.0';
export function necessityPrompt(before: string, after: string, context: string): { system: string; prompt: string } {
  return {
    system: [
      'You verify one proposed copy edit to an existing literary text. The author\'s wording is the reference; the editor is not.',
      'Judge two properties independently.',
      'NECESSARY: is BEFORE objectively wrong in this context, and does AFTER fix exactly that error? Objective errors: a misspelling or typo, broken grammar (agreement, a wrong case or verb form), an accidentally repeated word, an unambiguous punctuation or typography mistake, a stock filler phrase that is plainly out of place and breaks the sentence.',
      'Not necessary: synonym swaps; rephrasing for fluency, rhythm or clarity; optional commas or punctuation; older or period spellings and word forms (e.g. «итти», «галстух», "shew", "connexion"); regional spelling variants (colour/color); dialect, colloquial or uneducated speech, and a character\'s own voice; register; repetition the author may intend; removing words that are merely redundant. A changed word can still be necessary when it fixes a real error. If you are unsure whether BEFORE is wrong, answer false.',
      'PRESERVED: does AFTER keep every fact, name, action, implication, certainty, character state and the author\'s voice?',
      'Return JSON only: {"necessary":boolean,"preserved":boolean,"reason":"the rule BEFORE breaks, or why the edit is unnecessary or harmful"}.'
    ].join('\n'),
    prompt: ['BEFORE:', before, 'AFTER:', after, 'SURROUNDING PARAGRAPH:', context].join('\n\n')
  };
}

// Необходимость + структурный контекст (EditorialContext). Отдельная версия: прежний промпт necessity-1.0.0 не меняется.
export const necessityContextPromptVersion = 'necessity-context-1.0.0';
export function necessityContextPrompt(before: string, after: string, context: string, editorial: unknown): { system: string; prompt: string } {
  const base = necessityPrompt(before, after, context);
  return {
    system: [
      base.system.replace(/\nReturn JSON only:[^\n]*$/u, ''),
      'CONTEXT is computed by software from the manuscript and the author\'s configuration; treat it as fact. location.inside_quotes_or_dialogue_line says only whether the edit lies inside quotation marks or a dash-introduced dialogue line. Outside them the text may still be free indirect discourse or stylized narration (narrative_voice is unknown), so read the paragraph. edit.editor_category is the editor\'s own label and may be wrong. preservation lists the author\'s configured policies; configured:false means none was set.',
      'Decide NECESSARY from evidence, not from what is imaginable. If BEFORE breaks a grammatical or spelling rule and nothing in the paragraph or CONTEXT shows the form is deliberate, the edit is necessary; a merely conceivable stylistic reading is not evidence. Evidence that the form is deliberate: it is inside quoted speech or a dialogue line; the same nonstandard pattern recurs in the paragraph as a speaker\'s or narrator\'s idiom; dialect, colloquial or period forms surround it; or a preservation policy covers it. With such evidence, or if the case is genuinely unclear, answer false.',
      'Return JSON only: {"necessary":boolean,"preserved":boolean,"reason":"the rule BEFORE breaks, or the evidence that the form is deliberate, or why the edit is harmful"}.'
    ].join('\n'),
    prompt: ['CONTEXT:', JSON.stringify(editorial), base.prompt].join('\n\n')
  };
}
