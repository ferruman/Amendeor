import type { Rule, ProposalDraft } from './index.ts';

export const capitalization: Rule = {
  id: 'capitalization.sentence-start', version: '5', langs: ['en', 'ru'], category: 'capitalization', impact: 'mechanical', authority: 'contextual',
  detect(scene, ctx): ProposalDraft[] {
    const drafts: ProposalDraft[] = [];
    const abbreviations = new Set(ctx.pack.abbreviations.map((word) => word.toLowerCase()));
    for (const match of scene.text.matchAll(/([.!?])([ \t\r\n]+)([\p{Ll}][\p{L}]*)/gu)) {
      if (match[1] !== '.' && !/[\r\n]/.test(match[2]!)) continue;
      // Точка в многоточии («…», «...», «….») не заканчивает предложение: строчная буква после неё — авторская.
      if (match[1] === '.' && /[.…]/.test(scene.text[match.index! - 1] ?? '')) continue;
      const prefix = scene.text.slice(0, match.index! + 1).match(/[\p{L}.]+$/u)?.[0]?.toLowerCase() ?? '';
      // Инициал перед точкой — и после знака разметки: «*T. vulgaris*».
      if (abbreviations.has(prefix) || /(?:^|[^\p{L}])\p{Lu}\.$/u.test(scene.text.slice(Math.max(0, match.index! - 3), match.index! + 1))) continue;
      // Короткое строчное слово после числа — сокращение единицы: «2 pk. bath», «3 oz. flour».
      if (/\d[ \t]+\p{Ll}{1,3}\.$/u.test(scene.text.slice(Math.max(0, match.index! - 8), match.index! + 1))) continue;
      // Предложение до точки само начинается со строчной — текст нарочно строчный (сообщение, записка): «got it. free till 2».
      const line = scene.text.slice(0, match.index!).split(/\n/u).at(-1)!;
      // Начало считается и после двоеточия: сообщение или записка часто идут за ним — «…the phone away: got it. free till 2».
      const sentenceStart = line.split(/[.!?…:]\s+/u).at(-1)!.match(/\p{L}/u)?.[0];
      if (sentenceStart && sentenceStart === sentenceStart.toLocaleLowerCase() && sentenceStart !== sentenceStart.toLocaleUpperCase()) continue;
      const word = match[3]!;
      drafts.push({ target: match[0], replacement: `${match[1]}${match[2]}${word[0]!.toLocaleUpperCase()}${word.slice(1)}`, start: match.index!, reason: 'Capitalize the sentence opening.' });
    }
    return drafts;
  }
};
