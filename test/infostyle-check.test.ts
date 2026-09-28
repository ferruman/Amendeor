import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { splitScenes, type Book } from '../src/book.ts';
import { loadPack } from '../src/lang/pack.ts';
import { loadConfig } from '../src/config.ts';
import { openSource } from '../src/source/index.ts';
import { checkGuide } from '../src/checks/guide.ts';
import { infostyle } from '../src/checks/infostyle.ts';
import { checkGuideContextual, loadPrinciples } from '../src/checks/guide-context.ts';

const asBook = (text: string): Book => ({ lang: 'ru', chapters: [{ slug: 'one', title: 'Одна', file: 'one.md', text, scenes: splitScenes(text) }] });

test('infostyle signals mark narrator phrases with exact spans and skip dialogue', async () => {
  const pack = (await loadPack('ru')).pack;
  const text = 'Как известно, в наши дни он оказывал помощь соседям посредством писем. Потом сделал разрешающий жест.\n— В наши дни все принимают участие, — сказал он.';
  const findings = checkGuide(infostyle, asBook(text), pack);
  assert.deepEqual(findings.map((item) => item.id), ['info.common-knowledge', 'info.time-parasite', 'info.empty-verb', 'info.office-phrase', 'info.participle-gesture']);
  for (const item of findings) {
    assert.equal(text.slice(item.start, item.end), item.quote);
    assert.equal(item.guide, 'infostyle');
    assert.match(item.principle, /^info\./);
  }
  assert.deepEqual(checkGuide(infostyle, asBook('Он проверил дверь и вышел во двор.'), pack), []);
});

test('infostyle catalog loads every principle and signals point at catalogued principles', async () => {
  const principles = await loadPrinciples(infostyle);
  assert.equal(principles.length, 10);
  const ids = new Set(principles.map((item) => item.id));
  for (const signal of infostyle.signals) assert.ok(ids.has(signal.principle), signal.principle);
});

test('infostyle contextual check drops findings inside dialogue before verification', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'amendeor-infostyle-'));
  try {
    const file = path.join(root, 'book.md');
    const script = path.join(root, 'script.json');
    await writeFile(file, 'Дверь была открыта неизвестным лицом.\n\n— Это феноменальный успех, — сказал он.\n');
    await writeFile(script, JSON.stringify({ responses: {
      editor: JSON.stringify({ findings: [
        { principle: 'info.passive-agent', quote: 'была открыта неизвестным лицом', reason: 'Страдательный оборот прячет, кто открыл дверь, хотя сцене это важно.' },
        { principle: 'info.inflated-word', quote: 'феноменальный успех', reason: 'Громкое слово раздувает обычное событие без видимой иронии.' }
      ] }),
      verifier: JSON.stringify({ accepted: [0] })
    } }));
    const loaded = await loadConfig({ env: { HOME: root }, cli: { providers: { local: { transport: 'local', endpoint: script } }, profiles: { edit: { provider: 'local', model: 'editor' }, verify: { provider: 'local', model: 'verifier', passes: 1 } } } });
    const source = await openSource(file, { lang: 'ru', out: path.join(root, 'out') });
    const result = await checkGuideContextual(infostyle, source.book, (await loadPack('ru')).pack, loaded, source.stateDir);
    assert.deepEqual(result.findings.map((item) => item.principle), ['info.passive-agent']);
    assert.equal(result.findings[0]!.guide, 'infostyle');
    assert.ok(result.discarded.some((item) => item.reason === 'finding quote is inside dialogue'));
  } finally { await rm(root, { recursive: true, force: true }); }
});
