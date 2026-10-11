import type { Rule, ProposalDraft } from './index.ts';

// Прямая открывающая и типографская закрывающая кавычка в одной реплике — несогласованность, а не стиль.
// Правило чинит только такую пару и только к стилю, который задан в normalize.quotes или явно преобладает в книге (≥ 90% из ≥ 10 знаков).
function establishedStyle(ctx: Parameters<Rule['detect']>[1]): 'curly' | 'straight' | null {
  const configured = ctx.config.normalize.quotes;
  if (configured === '“”') return 'curly';
  if (configured === '""') return 'straight';
  if (configured && configured !== 'keep') return null;
  let curly = 0, straight = 0;
  for (const chapter of ctx.book.chapters) for (const scene of chapter.scenes) { curly += (scene.text.match(/[“”]/g) ?? []).length; straight += (scene.text.match(/"/g) ?? []).length; }
  if (curly >= 10 && straight * 9 <= curly) return 'curly';
  if (straight >= 10 && curly * 9 <= straight) return 'straight';
  return null;
}

export const mixedQuotes: Rule = {
  id: 'typography.mixed-quotes', version: '1', langs: ['en'], category: 'typography', impact: 'mechanical', authority: 'mechanical',
  detect(scene, ctx): ProposalDraft[] {
    const style = establishedStyle(ctx);
    if (!style) return [];
    const drafts: ProposalDraft[] = [];
    for (const match of scene.text.matchAll(/"([^"“”\r\n]+)”|“([^"“”\r\n]+)"/g)) {
      const inner = match[1] ?? match[2]!;
      drafts.push({ target: match[0], replacement: style === 'curly' ? `“${inner}”` : `"${inner}"`, start: match.index!, reason: 'Make the opening and closing quotation marks of one quotation match.' });
    }
    return drafts;
  }
};
