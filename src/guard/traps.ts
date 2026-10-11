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
// Заглавное слово в начале предложения — имя, только если книга пишет его с заглавной и вне начала предложения.
// Без контекста сцены (prefix) действует прежнее консервативное правило: любое заглавное слово — имя.
function sentenceStart(prefix: string): boolean {
  const text = prefix.replace(/\s+$/u, '');
  return !text || /\n/u.test(prefix.slice(text.length)) || /[.!?…][\p{Pe}\p{Pf}"'»]*$/u.test(text) || /[\p{Ps}\p{Pi}"«]$/u.test(text) || /(?:^|\n)[ \t]*[—–-]$/u.test(text);
}
function names(text: string, context?: { prefix: string; bookNames: Map<string, number> }): string[] {
  return words(text).filter((token) => /^\p{Lu}/u.test(token.text) && token.text.length > 1
    && !(context && !context.bookNames.has(token.text) && sentenceStart(context.prefix + text.slice(0, token.start))) && !['The', 'He', 'She', 'They', 'It', 'There', 'This', 'That', 'At', 'In', 'On', 'What', 'Let', 'But', 'And', 'For', 'Он', 'Она', 'Они', 'Это', 'Было', 'Ключ', 'Деньги', 'Поезд', 'Дверь', 'Письмо', 'Часы', 'Книга'].includes(token.text)).map((token) => token.text);
}
function numberTokens(text: string): string[] { return words(text).map((token) => token.lower).filter((token) => /^\d/u.test(token) || ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'twenty', 'thirty', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'двадцать', 'тридцать'].includes(token)); }
function dialogueWords(text: string): string { return words(text).map((word) => word.lower).join(' '); }
// Расстояние с перестановкой соседних букв (OSA): «goign» → «going» — одна опечатка, а не две.
function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => i || j ? (i ? (j ? 0 : i) : j) : 0));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
  }
  return d[a.length]![b.length]!;
}
function typoOnly(before: string, after: string): boolean {
  const a = words(before).map((word) => word.lower), b = words(after).map((word) => word.lower);
  return a.length === b.length && a.every((word, index) => word === b[index] || distance(word, b[index]!) <= Math.min(2, Math.floor(Math.max(word.length, b[index]!.length) / 3)));
}
function droppedName(before: string, namesBefore: string[], namesAfter: string[], stem: boolean): boolean {
  // В русском имя склоняется: вхождения считаются по основе, как в changed().
  const count = (list: string[], name: string) => list.filter((item) => stem ? sameStem(item, name) : item === name).length;
  return [...new Set(namesBefore)].some((name) => {
    const doubled = [...before.matchAll(new RegExp(`(?<![\\p{L}])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'gu'))].length;
    const lost = count(namesBefore, name) - count(namesAfter, name);
    return lost > doubled;
  });
}
export function commaOnlyChange(before: string, after: string): boolean {
  return (before.match(/,/gu) ?? []).length !== (after.match(/,/gu) ?? []).length && before.replace(/,/gu, '') === after.replace(/,/gu, '');
}

type TrapOptions = { category?: Proposal['category']; inDialogue?: boolean; modelGenerated?: boolean; allowCommaCorrection?: boolean; dialogueTypoAuthorized?: boolean; nameContext?: { prefix: string; bookNames: Map<string, number> }; typoReview?: boolean };
const letters = (text: string) => words(text).map((word) => word.lower).join('');
// Правка формы опечатки (AUDIT F2): те же слова с мелкими описками (typoOnly), только пробел между словами («В кратце» → «Вкратце»)
// или одна лишняя либо пропущенная буква («с Степом» → «со Степом», «С один борт» → «Один борт»); знаки препинания те же.
export function typoShaped(before: string, after: string): boolean {
  if (before === after || before.replace(/[\p{L}\p{N}\s]/gu, '') !== after.replace(/[\p{L}\p{N}\s]/gu, '')) return false;
  if (typoOnly(before, after)) return true;
  const a = letters(before), b = letters(after);
  return a === b || Math.abs(a.length - b.length) === 1 && distance(a, b) === 1;
}
// Ловушки, которые срабатывают и на опечатке. Такая правка не принимается и не отклоняется молча: она становится находкой
// на проверку (только поштучно, с явным согласием), если остальные ловушки её пропускают. Отрицание можно лишь слить
// или разделить («не плохо» → «неплохо»); «имя» может отличаться только регистром («— до» → «— До»), но не буквами (Hyde → Hide).
export const typoReviewTraps = ['dialogue-content-change', 'negation-change', 'proper-name-change'];
export function typoReviewable(trap: string, before: string, after: string, pack: LanguagePack, options: TrapOptions = {}): boolean {
  if (!typoReviewTraps.includes(trap) || !typoShaped(before, after)) return false;
  if (trap === 'negation-change' && letters(before) !== letters(after)) return false;
  if (trap === 'proper-name-change') {
    const namesBefore = names(before, options.nameContext), namesAfter = names(after, options.nameContext);
    const lower = (text: string) => new Set(words(text).map((word) => word.lower));
    const lowerBefore = lower(before), lowerAfter = lower(after);
    if (!namesBefore.filter((name) => !namesAfter.includes(name)).every((name) => lowerAfter.has(name.toLocaleLowerCase(pack.language)))
      || !namesAfter.filter((name) => !namesBefore.includes(name)).every((name) => lowerBefore.has(name.toLocaleLowerCase(pack.language)))) return false;
  }
  return semanticTrap(before, after, pack, { ...options, typoReview: true }) === null;
}

export function semanticTrap(before: string, after: string, pack: LanguagePack, options: TrapOptions = {}): string | null {
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
  // typoReview: правку формы опечатки уже признали такой; остальные ловушки проверяют её как обычно.
  const review = Boolean(options.typoReview);
  if (!review && (before.match(/\b\p{L}+n['’]t\b/giu) ?? []).length !== (after.match(/\b\p{L}+n['’]t\b/giu) ?? []).length) return 'negation-change';
  if (!review && changed(selected(before, pack.negation), selected(after, pack.negation))) return 'negation-change';
  // Имена сравниваются с учётом числа вхождений: если имя встречается в цели дважды, пропажа одного вхождения — тоже смена
  // имени («…; Тётка» → «…; тётка»). Исключение — удвоенное подряд имя («Иваныч Иваныч» → «Иваныч»): это опечатка-повтор.
  const namesBefore = names(before, options.nameContext), namesAfter = names(after, options.nameContext);
  // Пропажа вхождения имени отклоняется и для правки формы опечатки: «Тётка» → «тётка» — это смена имени, а не регистра.
  if ((!review && changed([...new Set(namesBefore)], [...new Set(namesAfter)], lang !== 'en')) || droppedName(before, namesBefore, namesAfter, lang !== 'en')) return 'proper-name-change';
  if (changed(selected(before, pack.modal), selected(after, pack.modal))) return 'certainty-change';
  if (changed(selected(before, lexicons[lang]?.certainty ?? []), selected(after, lexicons[lang]?.certainty ?? []))) return 'certainty-change';
  for (const type of ['location', 'ownership', 'intention', 'chronology']) {
    const list = lexicons[lang]?.[type] ?? [];
    if (changed(selected(before, list), selected(after, list))) return type + '-change';
  }
  if (options.inDialogue && dialogueWords(before) !== dialogueWords(after)) {
    if (options.category !== 'dialogue-mechanics') { if (!review) return 'dialogue-content-change'; }
    // Категорию выбирает сама модель, поэтому она не разрешает менять слова реплики: только опечатка
    // (те же слова по числу, каждое близко по написанию) и только при явной нормализации автора.
    else if (options.modelGenerated && !(options.dialogueTypoAuthorized && typoOnly(before, after))) return 'dialogue-mechanics-content-change';
  }
  return null;
}
