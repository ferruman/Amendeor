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
