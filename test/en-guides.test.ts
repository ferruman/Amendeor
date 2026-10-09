import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { splitScenes, type Book } from '../src/book.ts';
import { loadPack } from '../src/lang/pack.ts';
import { loadConfig } from '../src/config.ts';
import { openSource } from '../src/source/index.ts';
import { checkGuide, dedupeFindings, type Guide, type GuideFinding } from '../src/checks/guide.ts';
import { checkGuideContextual, guidePrompts, loadPrinciples } from '../src/checks/guide-context.ts';
import { enClarity, enFictionEditing, enProseStyle, englishGuides } from '../src/checks/en-guides.ts';
import { noraGal } from '../src/checks/nora-gal.ts';
import { infostyle } from '../src/checks/infostyle.ts';
import { toFindings } from '../src/checks/findings.ts';

const execFileAsync = promisify(execFile);
const cli = path.resolve('src/cli.ts');
const asBook = (text: string, lang = 'en'): Book => ({ lang, chapters: [{ slug: 'one', title: 'One', file: 'one.md', text, scenes: splitScenes(text) }] });
const signalFixture = JSON.parse(await readFile(new URL('./fixtures/en-guide-signals.json', import.meta.url), 'utf8')) as Record<string, { flag: Array<[string, string]>; keep: string[] }>;

async function contextual(guide: Guide, text: string, responses: { editor: string; verifier: string }, passes = 1) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'amendeor-en-guide-'));
  const file = path.join(root, 'book.md');
  const script = path.join(root, 'script.json');
  await writeFile(file, text);
  await writeFile(script, JSON.stringify({ responses }));
  const loaded = await loadConfig({ env: { HOME: root }, cli: { providers: { local: { transport: 'local', endpoint: script } }, profiles: { edit: { provider: 'local', model: 'editor' }, verify: { provider: 'local', model: 'verifier', passes } } } });
  const source = await openSource(file, { lang: 'en', out: path.join(root, 'out') });
  const result = await checkGuideContextual(guide, source.book, (await loadPack('en')).pack, loaded, source.stateDir, true);
  return { result, source, file, root };
}

test('all four English guides load complete catalogs with keep-when and severity, and signals point at catalogued principles', async () => {
  const ids = new Set<string>();
  for (const guide of englishGuides) {
    assert.equal(guide.language, 'en');
    const principles = await loadPrinciples(guide);
    assert.equal(principles.length, guide.minPrinciples, guide.id);
    for (const item of principles) {
      assert.match(item.id, new RegExp(`^${guide.prefix}\\.`));
      assert.ok(item.keep, `${item.id} has keep-when`);
      assert.ok(['medium', 'low', 'info'].includes(item.severity!), `${item.id} severity`);
      assert.ok(!ids.has(item.id), `${item.id} is unique across guides`);
      ids.add(item.id);
    }
    const local = new Set(principles.map((item) => item.id));
    for (const signal of guide.signals) assert.ok(local.has(signal.principle), signal.principle);
  }
  assert.deepEqual(englishGuides.map((guide) => guide.id), ['en-fiction-editing', 'en-clarity', 'en-prose-style']);
  assert.equal(ids.size, 64);
});

test('Russian catalogs parse exactly as before: same counts, no English-only fields', async () => {
  const gal = await loadPrinciples(noraGal);
  assert.equal(gal.length, 30);
  assert.equal(gal.filter((item) => item.mode === 'П').length, 3);
  assert.equal((await loadPrinciples(infostyle)).length, 10);
  for (const item of gal) assert.deepEqual(Object.keys(item).sort(), ['id', 'mode', 'question', 'sourcePages']);
});

test('every English signal flags its examples with exact spans and keeps its exceptions', async () => {
  const pack = (await loadPack('en')).pack;
  const signals = new Map(englishGuides.flatMap((guide) => guide.signals.map((signal) => [signal.id, guide] as const)));
  assert.deepEqual([...signals.keys()].sort(), Object.keys(signalFixture).sort());
  for (const [id, cases] of Object.entries(signalFixture)) {
    const guide = signals.get(id)!;
    for (const [text, quote] of cases.flag) {
      const hits = checkGuide(guide, asBook(text), pack).filter((item) => item.id === id);
      assert.deepEqual(hits.map((item) => item.quote), [quote], `${id} flags: ${text}`);
      assert.equal(text.slice(hits[0]!.start, hits[0]!.end), quote);
    }
    for (const text of cases.keep) assert.deepEqual(checkGuide(guide, asBook(text), pack).filter((item) => item.id === id), [], `${id} keeps: ${text}`);
  }
});

test('signals skip dialogue but read narration, and fire nothing on the clean English control', async () => {
  const pack = (await loadPack('en')).pack;
  const text = '“Due to the fact that we are late, each and every one of us will leave no stone unturned,” he said.\nDue to the fact that it rained, they stayed.';
  const quotes = [enClarity, enProseStyle].flatMap((guide) => checkGuide(guide, asBook(text), pack)).map((item) => item.quote);
  assert.deepEqual(quotes, ['Due to the fact that']);
  assert.equal(text.indexOf('Due to the fact that', 10), checkGuide(enClarity, asBook(text), pack)[0]!.start);
  const control = await readFile(new URL('./fixtures/control-en.md', import.meta.url), 'utf8');
  for (const guide of englishGuides) assert.deepEqual(checkGuide(guide, asBook(control), pack), [], guide.id);
});

test('guides apply only to their language: English guides skip Russian text, Russian guides skip English text', async () => {
  const ru = (await loadPack('ru')).pack;
  const en = (await loadPack('en')).pack;
  assert.deepEqual(checkGuide(enClarity, asBook('Вследствие того что шёл дождь, он остался.', 'ru'), ru), []);
  assert.deepEqual(checkGuide(noraGal, asBook('Due to the fact that it rained, the clerk conducted an investigation.'), en), []);
  const { result } = await contextual(enClarity, 'A plain sentence.\n', { editor: '{"findings":[]}', verifier: '{"accepted":[]}' }).then((value) => { void rm(value.root, { recursive: true, force: true }); return value; });
  assert.equal(result.status, 'ok');
  const root = await mkdtemp(path.join(os.tmpdir(), 'amendeor-en-lang-'));
  try {
    const file = path.join(root, 'book.md');
    await writeFile(file, 'Он осуществляет проверку.\n');
    const loaded = await loadConfig({ env: { HOME: root }, cli: { providers: { local: { transport: 'local' } }, profiles: { edit: { provider: 'local', model: 'a' }, verify: { provider: 'local', model: 'b' } } } });
    const source = await openSource(file, { lang: 'ru', out: path.join(root, 'out') });
    await assert.rejects(checkGuideContextual(enFictionEditing, source.book, ru, loaded, source.stateDir), /supports English manuscripts only/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('CLI registers the English guides and refuses a guide in the wrong language', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'amendeor-en-cli-'));
  try {
    const env = { ...process.env, HOME: root, XDG_CONFIG_HOME: path.join(root, 'no-config') };
    const en = path.join(root, 'en.md');
    const original = '“Not tonight,” she smiled.\nDue to the fact that it rained, the radio blared loudly.\n';
    await writeFile(en, original);
    const output = await execFileAsync(process.execPath, [cli, 'check', en, '--lang', 'en', '--guide', 'en-fiction-editing', '--rules-only', '--json'], { env });
    const result = JSON.parse(output.stdout) as { guide: string; findings: Array<{ id: string; principle: string }> };
    assert.equal(result.guide, 'en-fiction-editing');
    assert.deepEqual(result.findings.map((item) => item.principle), ['fiction.said-bookism']);
    const clarity = JSON.parse((await execFileAsync(process.execPath, [cli, 'check', en, '--lang', 'en', '--guide', 'en-clarity', '--rules-only', '--json'], { env })).stdout) as { count: number };
    assert.equal(clarity.count, 2);
    await assert.rejects(execFileAsync(process.execPath, [cli, 'check', en, '--lang', 'en', '--guide', 'nora-gal', '--rules-only'], { env }), /nora-gal checks ru manuscripts; this book is en/);
    await assert.rejects(execFileAsync(process.execPath, [cli, 'check', en, '--lang', 'en', '--guide', 'unknown'], { env }), /en-fiction-editing\|en-clarity\|en-prose-style$/m);
    const ru = path.join(root, 'ru.md');
    await writeFile(ru, 'Он осуществляет проверку.\n');
    await assert.rejects(execFileAsync(process.execPath, [cli, 'check', ru, '--lang', 'ru', '--guide', 'en-clarity', '--rules-only'], { env }), /en-clarity checks en manuscripts; this book is ru/);
    assert.equal(await readFile(en, 'utf8'), original);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('English contextual check verifies a dialogue finding, keeps severity, caches nothing on --no-cache and never touches the manuscript', async () => {
  const text = '“The roof is gone,” Ma said, and sat down on the step with the dish towel still in her hands. “The whole roof,” she said again, in shock.\n';
  const { result, source, file, root } = await contextual(enFictionEditing, text, {
    editor: JSON.stringify({ findings: [{ principle: 'fiction.explained-emotion', quote: 'she said again, in shock', reason: 'Sitting down with the towel still in her hands and repeating the line already show her shock, so naming it adds nothing the scene has not shown.' }] }),
    verifier: JSON.stringify({ accepted: [0] })
  }, 3);
  try {
    assert.equal(result.status, 'ok');
    assert.equal(result.findings.length, 1);
    const finding = result.findings[0]!;
    assert.equal(finding.principle, 'fiction.explained-emotion');
    assert.equal(finding.severity, 'low');
    assert.deepEqual(finding.verification, { agreed: 3, passes: 3 });
    assert.equal(source.book.chapters[0]!.scenes[0]!.text.slice(finding.start, finding.end), finding.quote);
    assert.equal(await readFile(file, 'utf8'), text);
    const written = toFindings(source.book, [finding], 'run', root);
    assert.equal(written[0]!.severity, 'low');
    assert.equal(written[0]!.category, 'style.fiction.explained-emotion');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('quote validation, unknown principles and hedged English reasons are discarded before verification', async () => {
  const text = 'The detective conducted an examination of the lock. The lock was old. The lock was old.\n';
  const { result, root } = await contextual(enClarity, text, {
    editor: JSON.stringify({ findings: [
      { principle: 'clarity.hidden-action', quote: 'a sentence that is not there', reason: 'The action is hidden in a noun after an empty verb in this narration.' },
      { principle: 'clarity.hidden-action', quote: 'The lock was old', reason: 'The action is hidden in a noun after an empty verb in this narration.' },
      { principle: 'fiction.explained-emotion', quote: 'conducted an examination', reason: 'Belongs to another guide and must not be accepted by this one.' },
      { principle: 'clarity.hidden-action', quote: 'conducted an examination', reason: 'Some readers may find the noun slightly heavier than a verb here.' }
    ] }),
    verifier: JSON.stringify({ accepted: [0] })
  });
  try {
    assert.deepEqual(result.findings, []);
    assert.equal(result.ledger.length, 1, 'no verifier call when nothing survives parsing');
    assert.deepEqual(result.discarded.map((item) => item.reason).sort(), [
      'finding quote is absent, repeated, or crosses paragraphs',
      'finding quote is absent, repeated, or crosses paragraphs',
      'finding reason is speculative',
      'unsupported principle: fiction.explained-emotion'
    ]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('narration-only English guides drop dialogue quotes; the fiction guide reads dialogue', async () => {
  const text = '“Due to the fact that I am tired, I will sit,” he said. He sat by the window.\n';
  const finding = { principle: 'clarity.inflated-phrase', quote: 'Due to the fact that I am tired', reason: 'A stock phrase stands where the plain word because would say the same.' };
  const narration = await contextual(enClarity, text, { editor: JSON.stringify({ findings: [finding] }), verifier: JSON.stringify({ accepted: [0] }) });
  try {
    assert.deepEqual(narration.result.findings, []);
    assert.match(narration.result.discarded[0]!.reason, /inside dialogue/);
    assert.equal(narration.result.ledger.length, 1);
  } finally { await rm(narration.root, { recursive: true, force: true }); }
  const dialogue = await contextual(enFictionEditing, text, {
    editor: JSON.stringify({ findings: [{ principle: 'fiction.stilted-dialogue', quote: 'Due to the fact that I am tired, I will sit', reason: 'A tired man at home speaks in an officialese and without contractions that nothing in the scene motivates.' }] }),
    verifier: JSON.stringify({ accepted: [0] })
  });
  try { assert.equal(dialogue.result.findings.length, 1); } finally { await rm(dialogue.root, { recursive: true, force: true }); }
});

test('verifier rejection drops an intentional choice; a broken verifier makes the check partial, not ok', async () => {
  const text = 'She ran. Ran. Past the gate, the dogs, the bins. Ran.\n';
  const candidate = { principle: 'prose.fragment-gimmick', quote: 'She ran. Ran.', reason: 'The fragment chops the line without adding punch to a calm scene with no tension.' };
  const rejected = await contextual(enProseStyle, text, { editor: JSON.stringify({ findings: [candidate] }), verifier: JSON.stringify({ accepted: [] }) });
  try {
    assert.equal(rejected.result.status, 'ok');
    assert.deepEqual(rejected.result.findings, []);
  } finally { await rm(rejected.root, { recursive: true, force: true }); }
  const broken = await contextual(enProseStyle, text, { editor: JSON.stringify({ findings: [candidate] }), verifier: 'not json' });
  try {
    assert.equal(broken.result.status, 'partial');
    assert.equal(broken.result.failures.length, 1);
    assert.deepEqual(broken.result.findings, []);
  } finally { await rm(broken.root, { recursive: true, force: true }); }
});

test('dedupe keeps one finding per principle and place, signal first, and keeps different principles', () => {
  const base = { guide: 'en-clarity' as const, source_pages: '', chapter: 'one', scene: 's0', reason: '', provenance: '' };
  const items: GuideFinding[] = [
    { ...base, id: 'clarity.inflated-phrase', principle: 'clarity.inflated-phrase', start: 0, end: 20, quote: 'Due to the fact that' },
    { ...base, id: 'ctx', principle: 'clarity.inflated-phrase', start: 0, end: 31, quote: 'Due to the fact that it rained,' },
    { ...base, id: 'ctx2', principle: 'clarity.logical-link', start: 0, end: 31, quote: 'Due to the fact that it rained,' },
    { ...base, id: 'ctx3', principle: 'clarity.inflated-phrase', start: 40, end: 50, quote: 'elsewhere.' },
    { ...base, id: 'other-scene', principle: 'clarity.inflated-phrase', scene: 's1', start: 0, end: 20, quote: 'Due to the fact that' }
  ];
  assert.deepEqual(dedupeFindings(items).map((item) => item.id), ['clarity.inflated-phrase', 'ctx2', 'ctx3', 'other-scene']);
});

test('English prompts carry the preservation rules and keep-when; the Russian prompt is unchanged', async () => {
  const principles = await loadPrinciples(enClarity);
  const scan = guidePrompts.en.scan(enClarity, principles, 'One', 'TEXT', '', '');
  assert.match(scan.system, /^You are a careful literary editor of English fiction/);
  assert.match(scan.system, /A stylistically unusual sentence is not necessarily a bad sentence/);
  assert.match(scan.system, /free indirect discourse/);
  assert.match(scan.system, /Say nothing about who or what wrote the text/);
  assert.match(scan.prompt, /clarity\.agentless-passive: .+ Keep when: The doer is unknown/);
  const verify = guidePrompts.en.verify(enClarity, 'TEXT', [{ principle: 'clarity.dangling-modifier', quote: 'x', reason: 'y' }], new Map(principles.map((item) => [item.id, item])));
  assert.match(verify.prompt, /"keep_when":"Absolute phrases/);
  const ru = guidePrompts.ru.scan(noraGal, await loadPrinciples(noraGal), 'Одна', 'TEXT', '', '');
  assert.match(ru.system, /^Ты осторожный литературный редактор русской прозы\. Выполняй диагностику по принципам Норы Галь, не правь текст\./);
  assert.doesNotMatch(ru.prompt, /Keep when/);
});
