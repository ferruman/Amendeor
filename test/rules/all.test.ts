import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configSchema } from '../../src/config.ts';
import { loadPack } from '../../src/lang/pack.ts';
import { splitScenes, type Book } from '../../src/book.ts';
import { rules, ruleContext, bookWordCounts } from '../../src/rules/index.ts';
import { properNouns } from '../../src/text/names.ts';

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
function bookWith(text: string, lang: string): Book { return { lang, chapters: [{ slug: 'one', title: 'One', file: 'one.md', text, scenes: splitScenes(text) }] }; }

const positives: Record<string, { en: string; ru: string; config?: object }> = {
  'repetition.doubled-word': { en: 'She said said yes.', ru: 'Он видел дом дом.' },
  'typography.whitespace': { en: 'A word  follows.', ru: 'Это слово  рядом.' },
  'punctuation.balance': { en: 'Look (here.', ru: 'Смотри (сюда.' },
  'typography.quotes': { en: 'He said "hello".', ru: 'Он сказал "привет".', config: { normalize: { quotes: '«»' } } },
  'typography.dashes-ellipsis': { en: 'Wait... then go.', ru: 'Жди... потом иди.', config: { normalize: { ellipsis: true } } },
  'capitalization.sentence-start': { en: 'Stop. next time.', ru: 'Стой. потом иди.' },
  'markdown.stray-marker': { en: 'This ## heading appears.', ru: 'Этот ## заголовок лишний.' },
  'consistency.spelling-variant': { en: 'colour color color', ru: 'всё все', config: { normalize: { yo: 'e' } } },
  'terminology.name-variant': { en: 'He saw Mara. They called Mara. He saw Maro.', ru: 'Он видел Ковригину. Она позвала Ковригину. Он видел Ковригену.' },
  'grammar.ru-sutki-numeral': { en: '', ru: 'Прошли три утраченных суток.' },
  'grammar.ru-pronoun-byl': { en: '', ru: 'Она был дома.' }
};

test('every declared rule fires on its positive sample in both advertised languages', async () => {
  for (const rule of rules) for (const lang of rule.langs) {
    const example = positives[rule.id]!;
    const book = bookWith(example[lang as 'en' | 'ru'], lang);
    const pack = (await loadPack(lang)).pack;
    const config = configSchema.parse(example.config ?? {});
    const scene = book.chapters[0]!.scenes[0]!;
    const results = rule.detect(scene, ruleContext(book, config, pack, scene, properNouns(book, pack), bookWordCounts(book)));
    assert.ok(results.length > 0, `${rule.id} did not detect its ${lang} positive sample`);
  }
});

test('both clean controls produce zero rule proposals', async () => {
  for (const lang of ['en', 'ru']) {
    const text = await readFile(path.join(fixtures, `control-${lang}.md`), 'utf8');
    const book = bookWith(text, lang); const pack = (await loadPack(lang)).pack; const config = configSchema.parse({});
    const scene = book.chapters[0]!.scenes[0]!;
    const ctx = ruleContext(book, config, pack, scene, properNouns(book, pack), bookWordCounts(book));
    for (const rule of rules.filter((item) => item.langs.includes(lang))) assert.deepEqual(rule.detect(scene, ctx), [], `${rule.id} flagged the ${lang} control`);
  }
});

test('Russian сутки rule leaves correct forms and unrelated nouns alone', async () => {
  const text = 'Прошло трое суток. Не было трёх суток. Пропали три дня. «Три суток», — повторил он.';
  const book = bookWith(text, 'ru');
  const pack = (await loadPack('ru')).pack;
  const config = configSchema.parse({});
  const scene = book.chapters[0]!.scenes[0]!;
  const rule = rules.find((item) => item.id === 'grammar.ru-sutki-numeral')!;
  assert.deepEqual(rule.detect(scene, ruleContext(book, config, pack, scene)), []);
});

test('Russian pronoun agreement rule skips correct forms and quoted speech', async () => {
  const text = 'Она была дома. Он был рядом. «Она был дома», — передразнил он.';
  const book = bookWith(text, 'ru');
  const pack = (await loadPack('ru')).pack;
  const scene = book.chapters[0]!.scenes[0]!;
  const rule = rules.find((item) => item.id === 'grammar.ru-pronoun-byl')!;
  assert.deepEqual(rule.detect(scene, ruleContext(book, configSchema.parse({}), pack, scene)), []);
});
