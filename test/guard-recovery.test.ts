import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, configSchema } from '../src/config.ts';
import { loadPack } from '../src/lang/pack.ts';
import { guardProposals } from '../src/guard/index.ts';
import { semanticTrap, typoReviewable, typoShaped } from '../src/guard/traps.ts';
import { makeProposal } from '../src/proposal/identity.ts';
import { splitScenes, type Book } from '../src/book.ts';
import { acceptProposals } from '../src/edited/decisions.ts';
import { Gateway } from '../src/provider/gateway.ts';
import { meter, SpendRefused } from '../src/provider/meter.ts';
import { book2Errors } from '../eval/replay-book2-guard.ts';

// Ловушки и verifier останавливали настоящие опечатки Book 2 (AUDIT F2/F3): теперь правка формы опечатки — находка на проверку.
const execFileAsync = promisify(execFile);
const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/cli.ts');

test('GR-1: every one of the 16 Book 2 corrections is typo-shaped; rewrites, word swaps and punctuation changes are not', () => {
  for (const [before, after] of book2Errors) assert.ok(typoShaped(before, after), `${before} → ${after}`);
  for (const [before, after] of [
    ['стоял, как стоял до прыжка', 'стоял, как и до прыжка'], ['от Комано слов', 'у Комано слов'], ['где Дурр не мог', 'куда Дурр не мог'],
    ['сплюнул на сухое', 'сплюнул на сухую землю'], ['Он ушёл. Она пришла.', 'Он ушёл, она пришла.'], ['in the house', 'on the house'], ['не разу', 'ни разу'], ['same', 'same']
  ]) assert.equal(typoShaped(before, after), false, `${before} → ${after}`);
});

test('GR-2: trap recovery is narrow — negation only fused or split, a "name" only by letter case, every other trap still applies', async () => {
  const ru = (await loadPack('ru')).pack, en = (await loadPack('en')).pack;
  const model = { modelGenerated: true, category: 'spelling' as const };
  assert.equal(typoReviewable('negation-change', 'я и с мечом хожу не плохо', 'я и с мечом хожу неплохо', ru, model), true);
  assert.equal(typoReviewable('negation-change', "I don't know", 'I do know', en, model), false);
  assert.equal(typoReviewable('negation-change', 'I was not there', 'I was no there', en, model), false, 'a negation word is never respelled');
  const at = (prefix: string) => ({ ...model, nameContext: { prefix, bookNames: new Map<string, number>() } });
  assert.equal(semanticTrap('— до рассвета', '— До рассвета', ru, at('— Не получится, — сказал я. ')), 'proper-name-change');
  assert.equal(typoReviewable('proper-name-change', '— до рассвета', '— До рассвета', ru, at('— Не получится, — сказал я. ')), true);
  assert.equal(typoReviewable('proper-name-change', 'Hyde went.', 'Hide went.', en, at('He paused. ')), false, 'a name respelled into a word stays rejected');
  assert.equal(typoReviewable('proper-name-change', 'Тётка прыгнула; Тётка не допрыгнула', 'Тётка прыгнула; тётка не допрыгнула', ru, model), false, 'a lost name occurrence stays rejected');
  assert.equal(typoReviewable('dialogue-content-change', '— Мы обменлись новостями.', '— Мы обменялись новостями.', ru, { ...model, inDialogue: true }), true);
  assert.equal(typoReviewable('dialogue-content-change', '— Ушёл вчера.', '— Ушёл позже.', ru, { ...model, inDialogue: true }), false);
  assert.equal(typoReviewable('ellipsis-change', 'Он ушёл…', 'Он ушёл.', ru, model), false, 'only the three typo-prone traps are recoverable');
});

// Мини-книга из настоящих фраз Book 2 и ответы verifier по тексту BEFORE (как в прогоне cc25). Нормализация реплик не задана.
const scene = [
  '— Ваши подвигы известны всем, — сказал он.', '— В кратце не значится.', '— Кто-то платит Коула, и платит не из Лакрана.',
  'Было видно, что у учителя не описуемое не только лицо.', '— Я и с мечом хожу не плохо, — сказал я.', '— Не получится, — сказал я. — до рассвета у меня коронация.',
  'Я сказал, что поедет я один.', 'Он подошёл с ботом на плече.', 'Те галофанийские стяги висели над воротами.',
  'Остальные три ушли за край, где Дурр не мог посмотреть.', 'С этой осади у меня остались шрамы.', 'Старик, который знает этой лестнице цену больше всех нас, молчал.', 'Она подняла кувшин со камня.'
].join('\n\n');
const edits: Array<[string, string, string]> = [
  ['Ваши подвигы', 'Ваши подвиги', 'spelling'], ['В кратце не значится.', 'Вкратце не значится.', 'spelling'], ['Кто-то платит Коула, и платит', 'Кто-то платит Коулу, и платит', 'grammar'],
  ['не описуемое не только', 'неописуемое не только', 'spelling'], ['хожу не плохо', 'хожу неплохо', 'spelling'], ['— до рассвета у меня', '— До рассвета у меня', 'capitalization'],
  ['поедет я', 'поеду я', 'grammar'], ['с ботом на плече', 'с бортом на плече', 'spelling'], ['галофанийские стяги', 'галафанийские стяги', 'spelling'],
  ['где Дурр не мог', 'куда Дурр не мог', 'word-choice'], ['С этой осади', 'С этой осады', 'grammar'], ['знает этой лестнице цену больше', 'знает цену этой лестнице лучше', 'grammar'],
  ['кувшин со камня', 'кувшин с камня', 'grammar']
];
const answers: Record<string, string[]> = {
  'поедет я': ['{"necessary":false,"preserved":true,"reason":"Standard Russian requires поеду я"}'],
  'с ботом на плече': ['{"necessary":false,"preserved":false,"reason":"бот is a real word"}'],
  'галофанийские стяги': ['{"necessary":false,"preserved":false,"reason":"invented adjective"}'],
  'где Дурр не мог': ['{"necessary":false,"preserved":true,"reason":"где is fine"}'],
  'С этой осади': ['{"necessary":false,"reason":"no preserved field"}', '{"necessary":false,"reason":"still no preserved field"}'],
  'знает этой лестнице цену больше': ['{"necessary":false,"reason":"no preserved field"}', '{"necessary":true,"preserved":true,"reason":"ok on retry"}', '{"necessary":true,"preserved":true,"reason":"ok"}', '{"necessary":true,"preserved":true,"reason":"ok"}'],
  'кувшин со камня': ['{"necessary":false,"preserved":true,"reason":"older euphonic form"}']
};

async function guardBook2(dir: string, answer: (before: string, call: number) => string | Response) {
  const book: Book = { lang: 'ru', chapters: [{ slug: 'one', title: 'Один', file: 'one.md', text: scene, scenes: splitScenes(scene) }] };
  const sceneId = book.chapters[0]!.scenes[0]!.id; const sceneText = book.chapters[0]!.scenes[0]!.text;
  const candidates = edits.map(([target, replacement, category]) => makeProposal({ chapter: 'one', scene: sceneId, category: category as never, target, replacement, sceneText, source: 'model', unverified: true }));
  const calls: Record<string, number> = {}; const prompts: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
    const prompt = body.messages[1]!.content; prompts.push(prompt);
    const before = Object.keys(answers).find((key) => prompt.includes('BEFORE:\n' + key) || prompt.includes(key)) ?? '?';
    calls[before] = (calls[before] ?? 0) + 1;
    const content = answer(before, calls[before]!);
    if (content instanceof Response) return content;
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
  }) as typeof fetch;
  try {
    const loaded = await loadConfig({ env: { HOME: dir }, cli: { providers: { v: { transport: 'openai', endpoint: 'http://verifier.test/v1/chat/completions', api_key: 'test' } }, profiles: { verify: { provider: 'v', model: 'verifier', passes: 1, check: 'necessity' } } } });
    return { ...(await guardProposals({ book, stateDir: dir } as never, loaded, await loadPack('ru'), candidates, true, 'copy')), calls, prompts };
  } finally { globalThis.fetch = original; }
}

test('GR-3: Book 2 sentences — typo-shaped trap and verifier rejections become review-only; harmful and non-typo edits stay rejected; schema failures are failures', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'amendeor-recovery-'));
  try {
    const result = await guardBook2(dir, (before, call) => answers[before]?.[call - 1] ?? '{"necessary":true,"preserved":true,"reason":"ok"}');
    const by = (target: string) => result.proposals.find((item) => item.target.text === target);
    const reviewOnly = ['Ваши подвигы', 'В кратце не значится.', 'Кто-то платит Коула, и платит', 'не описуемое не только', 'хожу не плохо', '— до рассвета у меня', 'поедет я', 'С этой осади', 'кувшин со камня'];
    for (const target of reviewOnly) {
      const proposal = by(target);
      assert.ok(proposal, `${target} is visible`);
      assert.equal(proposal!.unverified, true, target);
      assert.equal(proposal!.impact, 'prose', `${target}: never bulk or auto-accepted`);
      assert.equal(proposal!.review?.evidence.shape, 'typo');
      assert.deepEqual([proposal!.verification.semantic_risk, proposal!.verification.voice], ['unknown', 'unknown']);
    }
    assert.equal(by('— до рассвета у меня')!.review!.evidence.rejected_by, 'semantic-trap');
    assert.equal(by('поедет я')!.review!.evidence.rejected_by, 'semantic-verifier');
    assert.equal(by('С этой осади')!.review!.evidence.unchecked, 'verifier failure');
    // Отвергнутое verifier по обоим полям и не опечатка — остаётся отказом.
    assert.deepEqual(result.rejected.map((item) => [item.target, item.guard]).sort(), [['галофанийские стяги', 'semantic-verifier'], ['где Дурр не мог', 'semantic-verifier'], ['с ботом на плече', 'semantic-verifier']]);
    // Повтор на ответ не по схеме: вторая неудача — сбой verifier, не отказ; удачный повтор — обычная проверка.
    assert.equal(result.calls['С этой осади'], 2);
    assert.deepEqual(result.failures.map((item) => [item.target, item.kind, item.review_only]), [['С этой осади', 'verifier', true]]);
    assert.match(result.prompts.find((prompt) => prompt.includes('YOUR PREVIOUS ANSWER WAS INVALID'))!, /С этой осади|лестнице/u);
    assert.equal(by('знает этой лестнице цену больше')!.unverified, undefined, 'a malformed first answer is retried and then decides normally');
    const stage = result.stage as Record<string, number | string>;
    assert.deepEqual([stage.status, stage.offered, stage.review_only, stage.rejected, stage.verifier_failures, stage.provider_failures], ['partial', 1, 9, 3, 1, 0]);
    // Явное поштучное согласие обязательно: без --unverified ни одна из них не принимается, и делегат её не примет.
    for (const target of reviewOnly) await assert.rejects(acceptProposals(path.join(dir, 'edited'), [by(target)!], { acceptedBy: 'cli:codex' }), /unverified-proposal/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('GR-4: a run with only editorial outcomes is ok, not partial; a provider failure is classified as provider', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'amendeor-recovery-'));
  try {
    const clean = await guardBook2(dir, (before) => before === 'С этой осади' || before === 'знает этой лестнице цену больше' ? '{"necessary":false,"preserved":false,"reason":"no"}' : answers[before]?.[0] ?? '{"necessary":true,"preserved":true,"reason":"ok"}');
    assert.equal((clean.stage as { status: string }).status, 'ok');
    assert.equal(clean.failures.length, 0);
    const down = await guardBook2(dir, () => new Response(JSON.stringify({ error: { type: 'bad_request', message: 'no' } }), { status: 400 }));
    const kinds = new Set(down.failures.map((item) => item.kind));
    assert.deepEqual([...kinds], ['provider']);
    assert.equal(down.rejected.filter((item) => item.guard === 'semantic-verifier').length, 0, 'an unreachable verifier rejects nothing');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('GR-5: under a refused meter the gateway refuses before the OpenRouter pacing wait and before any request', async () => {
  const pack = (await loadPack('ru')).pack;
  const config = configSchema.parse({ providers: { p: { transport: 'openai', endpoint: 'https://openrouter.ai/api/v1/chat/completions', price: { input_per_m: 1, output_per_m: 1, currency: 'USD' } } }, profiles: { edit: { provider: 'p', model: 'm' } } });
  const gateway = new Gateway(config, pack, { }, { openai: { async complete() { throw new Error('the provider must not be called'); } } });
  const started = performance.now();
  for (let index = 0; index < 9; index++) await assert.rejects(meter.run({ spent: 0, refused: 'no delegation' }, () => gateway.complete('edit', 'edit', 's', 'p', 100)), SpendRefused);
  assert.ok(performance.now() - started < 500, `9 refusals took ${performance.now() - started} ms`);
});

test('GR-6: 9-window copy edit without delegation stops at the first refusal in under a second, exits 2, prints the refusal once and releases the lock', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'amendeor-refused-'));
  await mkdir(path.join(root, 'manuscript/chapters'), { recursive: true });
  await writeFile(path.join(root, 'codicora.yaml'), 'spec: codicora/v1\ntype: project\nproject: { id: book-a }\n');
  const chapters = Array.from({ length: 9 }, (_, index) => `c${index + 1}`);
  await writeFile(path.join(root, 'manuscript/manuscript.yaml'), `schema_version: 1\nlanguage: en\nchapters: [${chapters.map((slug) => `{ slug: ${slug}, title: ${slug} }`).join(', ')}]\n`);
  for (const slug of chapters) await writeFile(path.join(root, `manuscript/chapters/${slug}.md`), `<!-- scene: ${slug} -->\nShe said said yes in chapter ${slug}.\n`);
  // OpenRouter — тот провайдер, у которого есть слот 3,5 с; ключа нет, так что запрос в сеть невозможен.
  await writeFile(path.join(root, 'amendeor.yaml'), 'providers:\n  router:\n    transport: openai\n    endpoint: https://openrouter.ai/api/v1/chat/completions\n    api_key_env: AMENDEOR_TEST_ABSENT_KEY\n    price: { input_per_m: 1, output_per_m: 2, currency: USD }\nprofiles:\n  edit: { provider: router, model: fixture }\n');
  const env = { PATH: process.env.PATH, HOME: root, XDG_CONFIG_HOME: path.join(root, 'no-user-config'), CLAUDECODE: '1' };
  const started = performance.now();
  const failure = await execFileAsync(process.execPath, [cli, 'edit', root, '--mode', 'copy', '--no-cache'], { env }).then(() => assert.fail('must exit 2'), (error: { code?: number; stdout: string; stderr: string }) => error);
  const elapsed = performance.now() - started;
  assert.equal(failure.code, 2);
  assert.ok(elapsed < 1000, `took ${Math.round(elapsed)} ms`);
  assert.equal(failure.stderr.match(/not-delegated/gu)?.length, 1, failure.stderr);
  assert.match(failure.stdout, /model pass stopped at the first refused call: 0 window\(s\) done, 9 not sent; rules proposals are recorded/);
  await assert.rejects(stat(path.join(root, '.codicora/amendeor/lock')), 'the lock is released');
  const { run_id } = JSON.parse(await readFile(path.join(root, '.codicora/amendeor/latest.json'), 'utf8')) as { run_id: string };
  const run = JSON.parse(await readFile(path.join(root, '.codicora/amendeor/runs', run_id, 'run.json'), 'utf8')) as { stages: Array<Record<string, any>> };
  assert.deepEqual(run.stages.map((stage) => [stage.name, stage.status]), [['rules', 'ok'], ['model', 'refused'], ['guard', 'ok']]);
  assert.equal(run.stages[1]!.refused.windows_skipped, 9);
  // Защита замка не ослаблена: замок живого процесса по-прежнему останавливает прогон.
  await writeFile(path.join(root, '.codicora/amendeor/lock'), JSON.stringify({ pid: process.pid }));
  await assert.rejects(execFileAsync(process.execPath, [cli, 'edit', root, '--mode', 'mechanical'], { env: { ...env, CLAUDECODE: '' } }), /active process/);
  assert.ok(await stat(path.join(root, '.codicora/amendeor/lock')), 'an active lock is not deleted');
});
