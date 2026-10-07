import type { LanguagePack } from '../lang/pack.ts';
import { words } from '../text/segment.ts';
import { sameStem } from '../text/names.ts';
import type { Proposal } from '../proposal/schema.ts';

const lexicons: Record<string, Record<string, string[]>> = {
  en: {
    certainty: ['seemed', 'apparently', 'suspected', 'unsure', 'certain', 'possible', 'definitely', 'sure', 'knew'],
    location: ['upstairs', 'downstairs', 'north', 'south', 'east', 'west', 'inside', 'outside', 'front', 'back', 'above', 'below', 'under', 'over', 'station', 'church', 'drawer', 'cupboard', 'window', 'fireplace', 'table'],
    ownership: ['his', 'her', 'hers', 'their', 'theirs', 'my', 'mine', 'your', 'yours', 'our', 'ours', 'belonged', 'owned'],
    chronology: ['before', 'after', 'first', 'last', 'yesterday', 'tomorrow', 'morning', 'evening', 'earlier', 'later', 'already', 'yet', 'monday', 'tuesday', 'dawn', 'dusk', 'midnight'],
    intention: ['wanted', 'planned', 'intended', 'hoped', 'tried', 'meant', 'resolved', 'help', 'harm', 'leave', 'stay', 'return', 'escape', 'hide', 'reveal', 'refuse', 'accept', 'confess', 'deny', 'warn', 'accuse', 'forgive', 'punish', 'wait', 'go', 'save', 'abandon']
  },
  ru: {
    certainty: ['казался', 'видимо', 'подозревал', 'сомневалась', 'уверена', 'несомненно', 'знал'],
    location: ['наверху', 'внизу', 'север', 'юг', 'снаружи', 'внутри', 'переднюю', 'заднюю', 'станции', 'церкви', 'ящике', 'шкафу', 'окна', 'печи', 'столе', 'столом'],
    ownership: ['его', 'её', 'их', 'мой', 'моя', 'свой', 'свою', 'свои', 'принадлежал'],
    chronology: ['до', 'после', 'первой', 'последней', 'вчера', 'завтра', 'утром', 'вечером', 'раньше', 'позже', 'уже', 'ещё', 'понедельник', 'вторник', 'рассвете', 'закате', 'полуночи'],
    intention: ['хотел', 'хотела', 'собирался', 'собиралась', 'намеревались', 'надеялись', 'пытался', 'решил', 'помочь', 'навредить', 'уйти', 'остаться', 'вернуться', 'сбежать', 'скрыть', 'раскрыть', 'отказаться', 'согласиться', 'признаться', 'отрицать', 'предупредить', 'обвинить', 'простить', 'наказать', 'подождать', 'спасти', 'бросить']
  }
};

function selected(text: string, list: string[]): string[] { const set = new Set(list); return words(text).map((word) => word.lower).filter((word) => set.has(word)); }
function changed(a: string[], b: string[], stem = false): boolean {
  if (a.length !== b.length) return true;
  const rest = [...b];
  for (const item of a) { const index = rest.findIndex((other) => stem ? sameStem(item, other) : item === other); if (index < 0) return true; rest.splice(index, 1); }
  return rest.length > 0;
}
function names(text: string): string[] {
  return words(text).filter((token) => /^\p{Lu}/u.test(token.text) && token.text.length > 1 && !['The', 'He', 'She', 'They', 'It', 'There', 'This', 'That', 'At', 'In', 'On', 'What', 'Let', 'But', 'And', 'For', 'Он', 'Она', 'Они', 'Это', 'Было', 'Ключ', 'Деньги', 'Поезд', 'Дверь', 'Письмо', 'Часы', 'Книга'].includes(token.text)).map((token) => token.text);
}
function numberTokens(text: string): string[] { return words(text).map((token) => token.lower).filter((token) => /^\d/u.test(token) || ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'twenty', 'thirty', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'двадцать', 'тридцать'].includes(token)); }
function dialogueWords(text: string): string { return words(text).map((word) => word.lower).join(' '); }
export function commaOnlyChange(before: string, after: string): boolean {
  return (before.match(/,/gu) ?? []).length !== (after.match(/,/gu) ?? []).length && before.replace(/,/gu, '') === after.replace(/,/gu, '');
}

export function semanticTrap(before: string, after: string, pack: LanguagePack, options: { category?: Proposal['category']; inDialogue?: boolean; modelGenerated?: boolean; allowCommaCorrection?: boolean } = {}): string | null {
  const lang = pack.language.split('-')[0]!;
  const ellipses = (text: string) => (text.match(/…|(?<!\.)\.{3}(?!\.)/gu) ?? []).length;
  const verifiedCommaCandidate = options.allowCommaCorrection && options.category === 'punctuation' && commaOnlyChange(before, after);
  if (ellipses(before) !== ellipses(after)) return 'ellipsis-change';
  if (after !== before && after.trimEnd() === before) return 'trailing-space-only';
  if (after !== before && after.replace(/,\s+(?=и(?!\p{L})|and\b)/giu, ' ') === before) return 'coordinate-comma-insertion';
  if (options.modelGenerated && commaOnlyChange(before, after) && !verifiedCommaCandidate) return 'unsupported-comma-change';
  if (options.modelGenerated && lang === 'ru' && before !== after && before.replace(/ё/giu, 'е') === after.replace(/ё/giu, 'е')) return 'yo-normalization';
  if (lang === 'ru' && /(?:^|\s)[а-яё]{3,}(?:в|вши|ши)(?:сь)?(?=\s|,|$)/iu.test(after) && !/(?:^|\s)[а-яё]{3,}(?:в|вши|ши)(?:сь)?(?=\s|,|$)/iu.test(before) && /(?:^|\s)и(?=\s)/iu.test(before)) return 'sequence-to-gerund-change';
  if (options.modelGenerated && !verifiedCommaCandidate && before.replace(/[^\p{L}\p{N}]/gu, '') === after.replace(/[^\p{L}\p{N}]/gu, '')
    && (before.match(/[.,;:!?…—–'’"“”‘-]/gu) ?? []).join('') !== (after.match(/[.,;:!?…—–'’"“”‘-]/gu) ?? []).join('')) return 'punctuation-style-only';
  if (changed(numberTokens(before), numberTokens(after))) return 'number-date-time-change';
  if ((before.match(/\b\p{L}+n['’]t\b/giu) ?? []).length !== (after.match(/\b\p{L}+n['’]t\b/giu) ?? []).length) return 'negation-change';
  if (changed(selected(before, pack.negation), selected(after, pack.negation))) return 'negation-change';
  if (changed([...new Set(names(before))], [...new Set(names(after))], lang !== 'en')) return 'proper-name-change';
  if (changed(selected(before, pack.modal), selected(after, pack.modal))) return 'certainty-change';
  if (changed(selected(before, lexicons[lang]?.certainty ?? []), selected(after, lexicons[lang]?.certainty ?? []))) return 'certainty-change';
  for (const type of ['location', 'ownership', 'intention', 'chronology']) {
    const list = lexicons[lang]?.[type] ?? [];
    if (changed(selected(before, list), selected(after, list))) return type + '-change';
  }
  if (options.inDialogue && options.category !== 'dialogue-mechanics' && dialogueWords(before) !== dialogueWords(after)) return 'dialogue-content-change';
  return null;
}
