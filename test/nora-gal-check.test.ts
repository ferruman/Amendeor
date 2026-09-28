import test from 'node:test';
import assert from 'node:assert/strict';
import { splitScenes, type Book } from '../src/book.ts';
import { loadPack } from '../src/lang/pack.ts';
import { checkNoraGal } from '../src/checks/nora-gal.ts';
import { checkNoraGalContextual, loadNoraGalPrinciples } from '../src/checks/guide-context.ts';
import { loadConfig } from '../src/config.ts';
import { openSource } from '../src/source/index.ts';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const asBook = (text: string, lang = 'ru'): Book => ({ lang, chapters: [{ slug: 'one', title: 'Одна', file: 'one.md', text, scenes: splitScenes(text) }] });

test('separate guide check marks narrow office-language signals with exact spans', async () => {
  const text = 'Комиссия осуществляет проверку. В целях обеспечения порядка имело место событие.';
  const findings = checkNoraGal(asBook(text), (await loadPack('ru')).pack);
  assert.deepEqual(findings.map((item) => item.id), ['office.action-noun', 'office.purpose-frame', 'office.empty-existence']);
  for (const item of findings) {
    assert.equal(text.slice(item.start, item.end), item.quote);
    assert.equal(item.guide, 'nora-gal');
    assert.match(item.principle, /^gal\./);
    assert.ok(item.source_pages);
    assert.ok(item.reason);
  }
});

test('guide check skips dialogue and ordinary narrative', async () => {
  const text = '«Он осуществляет проверку», — сказал он.\n— В целях обеспечения порядка.\nОн проверил дверь и вышел.';
  assert.deepEqual(checkNoraGal(asBook(text), (await loadPack('ru')).pack), []);
  assert.deepEqual(checkNoraGal(asBook('She checked the door.', 'en'), (await loadPack('en')).pack), []);
});

test('contextual check loads the full catalog, verifies a finding and caches the window', async () => {
  const principles = await loadNoraGalPrinciples();
  assert.equal(principles.length, 30);
  assert.equal(principles.filter((item) => item.mode === 'П').length, 3);
  const root = await mkdtemp(path.join(os.tmpdir(), 'amendeor-gal-context-'));
  try {
    const file = path.join(root, 'book.md');
    const script = path.join(root, 'script.json');
    const original = 'Она испытала чувство радости, когда увидела брата.\n';
    await writeFile(file, original);
    await writeFile(script, JSON.stringify({ responses: {
      editor: JSON.stringify({ findings: [{ principle: 'gal.feeling-noun', quote: 'испытала чувство радости', reason: 'Отвлечённая рамка ослабляет непосредственное чувство героини в этой сцене.' }] }),
      verifier: JSON.stringify({ accepted: [0] })
    } }));
    const loaded = await loadConfig({ env: { HOME: root }, cli: { providers: { local: { transport: 'local', endpoint: script } }, profiles: { edit: { provider: 'local', model: 'editor' }, verify: { provider: 'local', model: 'verifier', passes: 3 } } } });
    const source = await openSource(file, { lang: 'ru', out: path.join(root, 'out') });
    const pack = (await loadPack('ru')).pack;
    const first = await checkNoraGalContextual(source.book, pack, loaded, source.stateDir);
    assert.equal(first.status, 'ok');
    assert.equal(first.checked, 1);
    assert.equal(first.findings.length, 1);
    assert.equal(first.findings[0]!.principle, 'gal.feeling-noun');
    assert.deepEqual(first.findings[0]!.verification, { agreed: 3, passes: 3 });
    assert.equal(source.book.chapters[0]!.scenes[0]!.text.slice(first.findings[0]!.start, first.findings[0]!.end), first.findings[0]!.quote);
    assert.equal(first.ledger.length, 4);
    const second = await checkNoraGalContextual(source.book, pack, loaded, source.stateDir);
    assert.equal(second.cached, 1);
    assert.equal(second.checked, 0);
    assert.deepEqual(second.findings, first.findings);
    assert.equal(await readFile(file, 'utf8'), original);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('contextual check rejects unsupported and verifier-rejected claims', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'amendeor-gal-reject-'));
  try {
    const file = path.join(root, 'book.md');
    const script = path.join(root, 'script.json');
    await writeFile(file, 'Она испытала чувство радости.\n');
    const loaded = await loadConfig({ env: { HOME: root }, cli: { providers: { local: { transport: 'local', endpoint: script } }, profiles: { edit: { provider: 'local', model: 'editor' }, verify: { provider: 'local', model: 'verifier', passes: 1 } } } });
    const source = await openSource(file, { lang: 'ru', out: path.join(root, 'out') });
    const pack = (await loadPack('ru')).pack;
    await writeFile(script, JSON.stringify({ responses: {
      editor: JSON.stringify({ findings: [{ principle: 'gal.translation-sense', quote: 'несуществующая цитата', reason: 'Модель предположила проблему перевода без исходного текста.' }] }),
      verifier: JSON.stringify({ accepted: [0] })
    } }));
    const unsupported = await checkNoraGalContextual(source.book, pack, loaded, source.stateDir);
    assert.deepEqual(unsupported.findings, []);
    assert.equal(unsupported.status, 'ok');
    assert.equal(unsupported.ledger.length, 1);
    assert.match(unsupported.discarded[0]!.reason, /unsupported principle/);
    const cached = await checkNoraGalContextual(source.book, pack, loaded, source.stateDir);
    assert.equal(cached.cached, 1);
    assert.deepEqual(cached.discarded, unsupported.discarded);
    await writeFile(script, JSON.stringify({ responses: {
      editor: JSON.stringify({ findings: [{ principle: 'gal.feeling-noun', quote: 'испытала чувство радости', reason: 'Отвлечённая рамка ослабляет непосредственное чувство героини в этой сцене.' }] }),
      verifier: JSON.stringify({ accepted: [] })
    } }));
    const rejected = await checkNoraGalContextual(source.book, pack, loaded, source.stateDir, true);
    assert.deepEqual(rejected.findings, []);
    assert.equal(rejected.status, 'ok');
  } finally { await rm(root, { recursive: true, force: true }); }
});
