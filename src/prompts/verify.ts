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
