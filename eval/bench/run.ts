// Стенд Editor × Verifier (2026-10-10). Платные вызовы — только в stage-a/stage-b и только под общим жёстким лимитом.
// node eval/bench/run.ts plan|corpus|stage-a|stage-b --out <name> [--resume] [--budget 3] [--repeats N] [--only id,…]
import { AsyncLocalStorage } from 'node:async_hooks';
import { appendFile, cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { openSource } from '../../src/source/index.ts';
import { configSchema, type Config } from '../../src/config.ts';
import { loadPack } from '../../src/lang/pack.ts';
import { editMechanical } from '../../src/edit/mechanical.ts';
import { editWindows } from '../../src/edit/windows.ts';
import { acceptProposals } from '../../src/edited/decisions.ts';
import { buildEdited } from '../../src/edited/build.ts';
import { makeProposal } from '../../src/proposal/identity.ts';
import { Cache } from '../../src/cache.ts';
import { Gateway } from '../../src/provider/gateway.ts';
import { verifyMeaning } from '../../src/guard/verify.ts';
import { deterministicGuard, editorialContext } from '../../src/guard/index.ts';
import { dialogueSpans, editInDialogue } from '../../src/text/dialogue.ts';
import { splitScenes, type Book } from '../../src/book.ts';
import type { Mutation } from '../mutate.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const amendeor = path.resolve(here, '../..');
type ModelSpec = { id: string; transport: 'openai' | 'anthropic'; endpoint?: string; reasoning_effort?: string };
type StageBConfig = { id: string; editor: string; verifier: string; tier: number; check?: 'meaning' | 'necessity'; diagnostic?: boolean; edit_diagnostic?: boolean; verify_context?: boolean };
const argv0 = process.argv.slice(2); const flag0 = (name: string) => { const index = argv0.indexOf(name); return index > 0 ? argv0[index + 1] : undefined; };
const bench = JSON.parse(await readFile(path.join(here, flag0('--configs') ?? 'configs.json'), 'utf8')) as { stage_a_variants?: Array<{ name: string; verifier: string; check: 'meaning' | 'necessity'; context?: boolean }>; cases?: string; models: Record<string, ModelSpec>; stage_b: StageBConfig[]; stage_a_verifiers: string[]; edit: { temperature: number; context_budget: number; mode: string }; verify: { passes: number }; works: string[]; corpus: string; repeats: number; budget_usd: number };
const argv = process.argv.slice(2);
const command = argv[0];
const flag = (name: string) => { const index = argv.indexOf(name); return index > 0 ? argv[index + 1] : undefined; };
const out = flag('--out');
if (!command || !['plan', 'corpus', 'stage-a', 'stage-b'].includes(command) || !out || !/^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)?$/.test(out)) throw new Error('usage: node eval/bench/run.ts plan|corpus|stage-a|stage-b --out <name> [--resume] [--budget 3] [--repeats N] [--only id,…]');
export const root = path.join(amendeor, 'eval/results', out);
const budget = Number(flag('--budget') ?? bench.budget_usd);
const only = flag('--only')?.split(',');
const keyEnv = 'AMENDEOR_OPENROUTER_API_KEY';
const exists = (file: string) => stat(file).then(() => true, () => false);
const readJsonl = async (file: string) => (await readFile(file, 'utf8').catch(() => '')).split('\n').filter(Boolean).map((line) => JSON.parse(line));
const requestsFile = () => path.join(root, 'requests.jsonl');
// Вложенный --out (стенд/часть): лимит общий для всех частей стенда, считается по всем их requests.jsonl.
async function spentSoFar(): Promise<number> {
  if (!out.includes('/')) return (await readJsonl(requestsFile())).reduce((sum, row) => sum + row.cost, 0);
  const parent = path.dirname(root); let total = 0;
  for (const name of await readdir(parent).catch(() => [] as string[])) total += (await readJsonl(path.join(parent, name, 'requests.jsonl'))).reduce((sum, row) => sum + row.cost, 0);
  return total;
}
const works = () => flag('--works')?.split(',') ?? bench.works;

// Пилотный корпус 2026-10-10: те же 10 сцен и 14 мутаций, собранные в рабочую область, которую открывает настоящий openSource.
async function buildCorpus(): Promise<void> {
  const historical = JSON.parse(await readFile(path.join(amendeor, 'eval/results/2026-10-10-model-comparison/corpus.json'), 'utf8')) as Array<{ work: string; book: Book; mutations: Mutation[]; preserve: unknown[]; control: string }>;
  for (const set of historical) {
    const dir = path.join(root, 'corpus', set.work);
    await rm(dir, { recursive: true, force: true });
    await cp(path.join(amendeor, 'eval/fixtures', set.work, 'mutated-formulaic'), dir, { recursive: true });
    const manifestFile = path.join(dir, 'manuscript/manuscript.yaml');
    const manifest = parseYaml(await readFile(manifestFile, 'utf8')) as { chapters: Array<{ slug: string }> };
    manifest.chapters = manifest.chapters.filter((chapter) => set.book.chapters.some((item) => item.slug === chapter.slug));
    await writeFile(manifestFile, stringifyYaml(manifest));
    for (const chapter of set.book.chapters) await writeFile(path.join(dir, 'manuscript/chapters', path.basename(chapter.file)), chapter.scenes.map((scene) => `<!-- scene: ${scene.id} -->\n${scene.text}`).join(''));
    const opened = await openSource(dir);
    for (const chapter of set.book.chapters) for (const scene of chapter.scenes) {
      const text = opened.book.chapters.find((item) => item.slug === chapter.slug)?.scenes.find((item) => item.id === scene.id)?.text;
      if (text !== scene.text) throw new Error(`corpus scene differs from the 2026-10-10 corpus: ${set.work} ${chapter.slug}/${scene.id}`);
    }
    if (opened.book.chapters.length !== set.book.chapters.length) throw new Error(`chapter count differs for ${set.work}`);
    await writeFile(path.join(dir, 'mutations.json'), `${JSON.stringify({ source: 'eval/results/2026-10-10-model-comparison/corpus.json', control_chapter: set.control, mutations: set.mutations }, null, 2)}\n`);
  }
  console.log(JSON.stringify({ corpus: path.join(root, 'corpus'), verified: 'scene texts identical to the 2026-10-10 corpus' }));
}

// Версионированная фикстура (например v3): полный mutated-<name>/ и mutations-<name>.json без изменений.
async function fixtureCorpus(name: string): Promise<void> {
  for (const work of works()) {
    const fixture = path.join(amendeor, 'eval/fixtures', work);
    const dir = path.join(root, 'corpus', work);
    await rm(dir, { recursive: true, force: true });
    await cp(path.join(fixture, name === 'original' ? 'original' : `mutated-${name}`), dir, { recursive: true });
    const meta = JSON.parse(await readFile(path.join(fixture, `mutations-${name}.json`), 'utf8')) as { mutations: Mutation[] };
    const control = (parseYaml(await readFile(path.join(dir, 'manuscript/manuscript.yaml'), 'utf8')) as { chapters: Array<{ slug: string; eval_control?: boolean }> }).chapters.find((chapter) => chapter.eval_control)?.slug;
    await writeFile(path.join(dir, 'mutations.json'), `${JSON.stringify({ source: `eval/fixtures/${work}/mutations-${name}.json`, control_chapter: control, mutations: meta.mutations }, null, 2)}\n`);
  }
  console.log(JSON.stringify({ corpus: path.join(root, 'corpus'), fixture: name }));
}

// Учёт: один requests.jsonl на весь стенд, фактический usage.cost провайдера (или generation API), резерв худшего случая до вызова.
interface Context { diagnostic?: boolean; stage: string; job: string; roles: Map<string, { role: string; effort?: string }>; capHit?: boolean; calls: Array<{ role: string; text: string | null; status: number; finish: string | null; cost: number; ms: number }> }
const context = new AsyncLocalStorage<Context>();
const catalog = new Map<string, { prompt: number; completion: number }>();
let spent = 0, reserved = 0;
function responseText(body: any): string | null {
  if (typeof body?.choices?.[0]?.message?.content === 'string') return body.choices[0].message.content;
  if (Array.isArray(body?.content)) return body.content.filter((item: any) => item.type === 'text').map((item: any) => item.text ?? '').join('');
  return null;
}
async function generationCost(nativeFetch: typeof fetch, id: string, key: string): Promise<number | null> {
  for (const wait of [1500, 3000, 6000]) {
    await new Promise((resolve) => setTimeout(resolve, wait));
    const response = await nativeFetch(`https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${key}` } });
    if (response.ok) { const body = await response.json() as { data?: { total_cost?: number } }; if (typeof body.data?.total_cost === 'number') return body.data.total_cost; }
  }
  return null;
}
// Диагностический проход (только стенд): две строки продакшен-промпта copy-edit заменяются просьбой методично найти объективные
// ошибки; остальные строки — защита имён и стиля, формат JSON, дословная цель — остаются. Изменился промпт — подмена не делается.
const productionLines = ['Most windows need no changes. Return {"edits":[]} for NO_CHANGE.', 'Suggest copy edits only when the gain is clear.'];
function diagnosticSystem(system: string): string {
  if (!productionLines.every((line) => system.includes(line))) throw new Error('copy-edit prompt changed; diagnostic substitution refused');
  return system
    .replace(productionLines[0]!, 'Diagnostic pass: read EDITABLE TEXT slowly, sentence by sentence and word by word, and report every OBJECTIVE error you find. Return {"edits":[]} only if there is none.')
    .replace(productionLines[1]!, 'Objective errors: misspelled or transposed letters; broken agreement (subject–verb, gender, number); a wrong word form or case; an accidentally doubled or missing word; a phrase or sentence fragment repeated by mistake; a stock phrase that is plainly out of place and breaks the sentence; an unambiguous punctuation slip. Do not report style, rhythm, word choice, period or regional spelling, dialect or a character\'s speech.');
}

function installMeter(): void {
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!/openrouter\.ai\/api\/v1\/(chat\/completions|messages)/.test(url)) return nativeFetch(input, init);
    const ctx = context.getStore();
    if (!ctx) throw new Error('unmetered model call outside a benchmark job');
    const body = JSON.parse(String(init!.body));
    const role = ctx.roles.get(body.model);
    if (!role) throw new Error(`model ${body.model} is not part of job ${ctx.job}`);
    if (role.effort && url.includes('/chat/completions')) body.reasoning = { enabled: true, effort: role.effort };
    if (ctx.diagnostic && role.role === 'editor') body.messages[0].content = diagnosticSystem(String(body.messages[0].content));
    if (url.includes('/chat/completions')) body.usage = { include: true };
    const price = catalog.get(body.model)!;
    const inputChars = JSON.stringify(body.messages ?? []).length + String(body.system ?? '').length;
    const worst = inputChars * price.prompt + Number(body.max_tokens ?? 4096) * price.completion;
    if (spent + reserved + worst > budget) { ctx.capHit = true; throw new Error(`benchmark budget cap $${budget} reached (spent ${spent.toFixed(4)}, reserved ${reserved.toFixed(4)})`); }
    reserved += worst;
    const started = Date.now();
    try {
      const response = await nativeFetch(input, { ...init, body: JSON.stringify(body) });
      const ms = Date.now() - started;
      const raw = await response.text();
      let parsed: any; try { parsed = JSON.parse(raw); } catch { /* сырой ответ сохраняется как есть */ }
      const usage = parsed?.usage;
      const tokensIn = usage?.prompt_tokens ?? usage?.input_tokens, tokensOut = usage?.completion_tokens ?? usage?.output_tokens;
      let cost: number, source: string;
      if (typeof usage?.cost === 'number') { cost = usage.cost; source = 'provider-usage'; }
      else {
        const generated = parsed?.id ? await generationCost(nativeFetch, parsed.id, String((init!.headers as Record<string, string>).authorization ?? '').replace(/^Bearer /, '')) : null;
        if (generated !== null) { cost = generated; source = 'provider-generation'; }
        else if (tokensIn !== undefined) { cost = tokensIn * price.prompt + tokensOut * price.completion; source = 'catalog-tokens'; }
        else { cost = response.ok ? worst : 0; source = response.ok ? 'reserved-worst-case' : 'error-no-usage'; }
      }
      spent += cost;
      const text = responseText(parsed);
      const finish = parsed?.choices?.[0]?.finish_reason ?? parsed?.stop_reason ?? null;
      ctx.calls.push({ role: role.role, text, status: response.status, finish, cost, ms });
      await appendFile(requestsFile(), JSON.stringify({ at: new Date().toISOString(), stage: ctx.stage, job: ctx.job, role: role.role, model: body.model, effort: role.effort ?? null, status: response.status, ms, max_tokens: body.max_tokens,
        finish, provider: parsed?.provider ?? null, usage: usage ?? null, cost, cost_source: source, request: body, response: parsed ?? raw }) + '\n');
      return new Response(raw, { status: response.status, headers: response.headers });
    } catch (error) {
      // Сетевой сбой мог быть оплачен: считается худший случай.
      if (!ctx.capHit) { spent += worst; await appendFile(requestsFile(), JSON.stringify({ at: new Date().toISOString(), stage: ctx.stage, job: ctx.job, role: role.role, model: body.model, status: 0, error: String(error), cost: worst, cost_source: 'reserved-worst-case' }) + '\n'); }
      throw error;
    } finally { reserved -= worst; }
  };
}

async function prepare(): Promise<void> {
  if (!process.env[keyEnv]) throw new Error(`${keyEnv} is not set`);
  if (!await exists(path.join(root, 'corpus'))) throw new Error('run the corpus command first');
  spent = await spentSoFar();
  // Средняя фактическая цена запроса модели — по всем журналам стендов в eval/results (только для оценки батча, не для лимита).
  const ledgers: string[] = [];
  const base = path.join(amendeor, 'eval/results');
  for (const name of await readdir(base).catch(() => [] as string[])) {
    ledgers.push(path.join(base, name, 'requests.jsonl'));
    for (const sub of await readdir(path.join(base, name)).catch(() => [] as string[])) ledgers.push(path.join(base, name, sub, 'requests.jsonl'));
  }
  for (const file of ledgers)
    for (const row of await readJsonl(file)) if (row.status === 200 && row.model) { const item = measured.get(row.model) ?? { n: 0, total: 0 }; item.n++; item.total += row.cost; measured.set(row.model, item); }
  const data = (await (await fetch('https://openrouter.ai/api/v1/models')).json()).data as Array<{ id: string; pricing: { prompt: string; completion: string } }>;
  for (const id of new Set(Object.values(bench.models).map((model) => model.id))) { const entry = data.find((item) => item.id === id); if (!entry) throw new Error(`model absent from the OpenRouter catalog: ${id}`); catalog.set(id, { prompt: Number(entry.pricing.prompt), completion: Number(entry.pricing.completion) }); }
  installMeter();
  console.log(JSON.stringify({ root, budget, spent_before: Number(spent.toFixed(6)) }));
}

function provider(spec: ModelSpec) {
  const price = catalog.get(spec.id)!;
  return { transport: spec.transport, endpoint: spec.endpoint ?? 'https://openrouter.ai/api/v1/chat/completions', api_key_env: keyEnv, family: spec.id.split('/')[0], price: { input_per_m: price.prompt * 1e6, output_per_m: price.completion * 1e6, currency: 'USD' } };
}
// edit_diagnostic / verify_context включают штатные profiles.edit.diagnostic и profiles.verify.context (не подмену промпта стенда).
function configFor(editor: ModelSpec | null, verifier: ModelSpec, passes = bench.verify.passes, check?: 'meaning' | 'necessity', features: { diagnostic?: boolean; context?: boolean } = {}): Config {
  return configSchema.parse({ preserve: [],
    providers: { ...(editor ? { editor: provider(editor) } : {}), verifier: provider(verifier) },
    profiles: { ...(editor ? { edit: { provider: 'editor', model: editor.id, temperature: bench.edit.temperature, ...(features.diagnostic ? { diagnostic: true } : {}), reasoning: Boolean(editor.reasoning_effort), context_budget: bench.edit.context_budget } } : {}),
      verify: { provider: 'verifier', model: verifier.id, passes, reasoning: Boolean(verifier.reasoning_effort), ...(verifier.reasoning_effort ? { reasoning_effort: verifier.reasoning_effort } : {}), ...(check ? { check } : {}), ...(features.context ? { context: true } : {}) } } });
}
// Оценка перед батчем: заведомо завышенная (символы как токены), чтобы не начать то, что может не уместиться.
// Если в журнале стенда уже есть ≥ 10 успешных запросов к модели, оценка — их средняя фактическая цена × 2 (запас);
// иначе — заведомо завышенная по каталогу. Жёсткий лимит на каждый запрос (installMeter) действует независимо.
const measured = new Map<string, { n: number; total: number }>();
function batchEstimate(calls: Array<{ model: string; inputChars: number; outputTokens: number; count: number }>): number {
  return calls.reduce((sum, call) => {
    const seen = measured.get(call.model);
    if (seen && seen.n >= 10) return sum + call.count * (seen.total / seen.n) * 2;
    const price = catalog.get(call.model)!; return sum + call.count * (call.inputChars * price.prompt + call.outputTokens * price.completion);
  }, 0);
}
function remainingOk(estimate: number, label: string): boolean {
  if (spent + estimate <= budget) return true;
  console.log(JSON.stringify({ stopped_before: label, estimate: Number(estimate.toFixed(4)), spent: Number(spent.toFixed(4)), budget }));
  return false;
}
const verdict = (text: string | null) => { try { const value = JSON.parse(text ?? ''); return typeof value.preserved === 'boolean' ? (value.preserved ? 'preserved' : 'changed') : 'schema-error'; } catch { return 'json-error'; } };

type StageACase = { id: string; category: string; language: string; before: string; after: string; context: string; origin_model: string; decision: string; severity: string | null; label_status: string };
async function stageA(): Promise<boolean> {
  const cases = (JSON.parse(await readFile(path.join(here, 'stage-a-cases.json'), 'utf8')) as { cases: StageACase[] }).cases;
  if (cases.some((item) => item.label_status !== 'approved' && item.label_status !== 'confirmed')) throw new Error('Stage A labels are not approved');
  for (const name of bench.stage_a_verifiers.filter((item) => !only || only.includes(item))) {
    const spec = bench.models[name]!;
    const target = path.join(root, 'stage-a', `${name}.json`);
    if (await exists(target)) { console.log(JSON.stringify({ verifier: name, skipped: 'done' })); continue; }
    if (!remainingOk(batchEstimate([{ model: spec.id, inputChars: 2600, outputTokens: 1024, count: cases.length * bench.verify.passes }]), `stage-a ${name}`)) return false;
    await mkdir(path.dirname(target), { recursive: true });
    const config = configFor(null, spec);
    const rows = [];
    for (const item of cases) {
      const pack = (await loadPack(item.language)).pack;
      // Детерминированный слой на той же правке: что дошло бы до verifier в производстве.
      const book: Book = { lang: item.language, chapters: [{ slug: 'case', title: 'Case', file: 'case.md', text: item.context, scenes: splitScenes(item.context) }] };
      const scene = book.chapters[0]!.scenes[0]!;
      const proposal = makeProposal({ chapter: 'case', scene: scene.id, category: 'grammar', target: item.before, replacement: item.after, sceneText: scene.text, source: 'model' });
      const check = deterministicGuard(proposal, scene.text, book, pack, config, 'copy');
      const self = item.origin_model === spec.id;
      const ctx: Context = { stage: 'stage-a', job: `${name}/${item.id}`, roles: new Map([[spec.id, { role: 'verifier', effort: spec.reasoning_effort }]]), calls: [] };
      const started = Date.now();
      const result = await context.run(ctx, () => verifyMeaning(item.before, item.after, item.context, 'prose', config, pack, new Cache(path.join(root, 'stage-a', 'state'), true), new Gateway(config, pack)));
      if (ctx.capHit) throw new Error(`budget cap reached in Stage A at ${ctx.job}`);
      if (ctx.calls.some((call) => call.status !== 200)) throw new Error(`provider errors in Stage A at ${ctx.job} (HTTP ${ctx.calls.map((call) => call.status).join(',')}); ${name} results not written`);
      const passes = ctx.calls.filter((call) => call.status === 200 && call.finish !== 'length' && call.finish !== 'max_tokens').map((call) => verdict(call.text));
      rows.push({ id: item.id, category: item.category, decision: item.decision, severity: item.severity, self_pairing: self, deterministic: 'guard' in check ? `${check.guard}: ${check.reason}` : 'passes',
        verifier: result.passed ? 'ACCEPT' : 'REJECT', reason: result.reason, verify_failed: result.reason.startsWith('verify failed'), passes_used: result.passes, pass_verdicts: passes,
        requests: ctx.calls.length, truncated: ctx.calls.filter((call) => call.finish === 'length' || call.finish === 'max_tokens').length, http_errors: ctx.calls.filter((call) => call.status !== 200).length, cost: ctx.calls.reduce((sum, call) => sum + call.cost, 0), ms: Date.now() - started });
    }
    await writeFile(target, `${JSON.stringify({ verifier: name, model: spec.id, effort: spec.reasoning_effort ?? 'off', passes: bench.verify.passes, rows }, null, 2)}\n`);
    console.log(JSON.stringify({ verifier: name, cases: rows.length, cost: Number(rows.reduce((sum, row) => sum + row.cost, 0).toFixed(5)), spent: Number(spent.toFixed(4)) }));
  }
  return true;
}

// Варианты verifier на одном наборе правок (check: meaning | necessity). Каждый вариант — 3 прохода; 1 проход — первый ответ того же прогона.
type NecessityCase = { id: string; category: string; language: string; before: string; after: string; context: string; origin_model: string; label: string };
async function stageAVariants(): Promise<boolean> {
  const cases = (JSON.parse(await readFile(path.join(here, bench.cases!), 'utf8')) as { cases: NecessityCase[] }).cases;
  for (const variant of bench.stage_a_variants!.filter((item) => !only || only.includes(item.name))) {
    const spec = bench.models[variant.verifier]!;
    const target = path.join(root, `${variant.name}.json`);
    if (await exists(target)) { console.log(JSON.stringify({ variant: variant.name, skipped: 'done' })); continue; }
    if (!remainingOk(batchEstimate([{ model: spec.id, inputChars: 3200, outputTokens: spec.reasoning_effort ? 1200 : 300, count: cases.length * bench.verify.passes }]), `stage-1 ${variant.name}`)) return false;
    const config = configFor(null, spec, bench.verify.passes, variant.check, { context: variant.context });
    const rows = [];
    for (const item of cases) {
      const pack = (await loadPack(item.language)).pack;
      const book: Book = { lang: item.language, chapters: [{ slug: 'case', title: 'Case', file: 'case.md', text: item.context, scenes: splitScenes(item.context) }] };
      const scene = book.chapters[0]!.scenes[0]!;
      const proposal = makeProposal({ chapter: 'case', scene: scene.id, category: 'grammar', target: item.before, replacement: item.after, sceneText: scene.text, source: 'model' });
      const check = deterministicGuard(proposal, scene.text, book, pack, config, 'copy');
      const ctx: Context = { stage: 'stage-1', job: `${variant.name}/${item.id}`, roles: new Map([[spec.id, { role: 'verifier', effort: spec.reasoning_effort }]]), calls: [] };
      const started = Date.now();
      const result = await context.run(ctx, () => verifyMeaning(item.before, item.after, item.context, 'prose', config, pack, new Cache(path.join(root, 'state'), true), new Gateway(config, pack), { necessity: variant.check === 'necessity', context: variant.context ? editorialContext(proposal, editInDialogue(dialogueSpans(scene.text, pack), scene.text, scene.text.indexOf(item.before), scene.text.indexOf(item.before) + item.before.length, item.after), dialogueSpans(scene.text, pack).length > 0, config) : undefined }));
      if (ctx.capHit) throw new Error(`budget cap reached in stage 1 at ${ctx.job}`);
      if (ctx.calls.some((call) => call.status !== 200)) throw new Error(`provider errors at ${ctx.job} (HTTP ${ctx.calls.map((call) => call.status).join(',')}); ${variant.name} not written`);
      rows.push({ id: item.id, label: item.label, category: item.category, language: item.language, self_pairing: item.origin_model === spec.id, deterministic: 'guard' in check ? `${check.guard}: ${check.reason}` : 'passes',
        decision: result.passed ? 'ACCEPT' : 'REJECT', reason: result.reason, verify_failed: result.reason.startsWith('verify failed'), passes_used: result.passes, answers: result.answers ?? [],
        requests: ctx.calls.length, truncated: ctx.calls.filter((call) => call.finish === 'length' || call.finish === 'max_tokens').length, cost: ctx.calls.reduce((sum, call) => sum + call.cost, 0), ms: Date.now() - started });
    }
    await writeFile(target, `${JSON.stringify({ variant: variant.name, verifier: variant.verifier, model: spec.id, effort: spec.reasoning_effort ?? 'off', check: variant.check, context: Boolean(variant.context), passes: bench.verify.passes, rows }, null, 2)}\n`);
    console.log(JSON.stringify({ variant: variant.name, cases: rows.length, cost: Number(rows.reduce((sum, row) => sum + row.cost, 0).toFixed(5)), spent: Number(spent.toFixed(4)) }));
  }
  return true;
}

async function stageB(): Promise<void> {
  const repeats = Number(flag('--repeats') ?? bench.repeats);
  const configs = bench.stage_b.filter((item) => !only || only.includes(item.id));
  // Порядок: по ярусам, внутри яруса — повтор за повтором, чтобы при нехватке бюджета каждый начатый ярус имел полные повторы.
  for (const tier of [...new Set(configs.map((item) => item.tier))].sort()) for (const config of configs.filter((item) => item.tier === tier)) for (let repeat = 0; repeat < repeats; repeat++) {
    const editor = bench.models[config.editor]!, verifier = bench.models[config.verifier]!;
    if (editor.id === verifier.id) throw new Error(`${config.id} pairs a model with itself`);
    if ([editor.id, verifier.id].some((id) => id.startsWith('z-ai/'))) throw new Error('the writer model may not edit or verify');
    const jobs = works().map((work) => ({ work, dir: path.join(root, 'stage-b', config.id, `${work}-${repeat}`) }));
    const pending = [];
    for (const job of jobs) if (!await exists(path.join(job.dir, 'result.json'))) pending.push(job);
    if (!pending.length) { console.log(JSON.stringify({ config: config.id, repeat, skipped: 'done' })); continue; }
    // Есть завершённые задания этой конфигурации — оценка по самому дорогому из них × 1.5; иначе по средним ценам запросов.
    const done: number[] = [];
    for (const name of await readdir(path.join(root, 'stage-b', config.id)).catch(() => [] as string[])) {
      const file = path.join(root, 'stage-b', config.id, name, 'result.json');
      if (await exists(file)) done.push((JSON.parse(await readFile(file, 'utf8')) as { calls: Array<{ cost: number }> }).calls.reduce((sum, call) => sum + call.cost, 0));
    }
    const estimate = done.length ? Math.max(...done) * 1.5 * pending.length : batchEstimate([{ model: editor.id, inputChars: 9000, outputTokens: 2500, count: 12 * pending.length }, { model: verifier.id, inputChars: 2600, outputTokens: 1024, count: 30 * pending.length }]);
    if (!remainingOk(estimate, `stage-b ${config.id} repeat ${repeat}`)) return;
    for (const { work, dir } of pending) {
      const job = `${config.id}/${work}-${repeat}`;
      await rm(dir, { recursive: true, force: true });
      const workspace = path.join(dir, 'workspace');
      await cp(path.join(root, 'corpus', work), workspace, { recursive: true });
      const source = await openSource(workspace);
      const pack = await loadPack(source.book.lang);
      const ctx: Context = { stage: 'stage-b', job, roles: new Map([[editor.id, { role: 'editor', effort: editor.reasoning_effort }], [verifier.id, { role: 'verifier', effort: verifier.reasoning_effort }]]), calls: [] };
      const started = Date.now();
      const loaded = { config: configFor(editor, verifier, bench.verify.passes, config.check, { diagnostic: config.edit_diagnostic, context: config.verify_context }), winningLayer: {}, warnings: [] };
      let result = await context.run(ctx, () => editMechanical(source, loaded, pack, { mode: bench.edit.mode, noCache: true }));
      // Диагностическая ветка: второй проход того же редактора на свежей копии, предложения объединяются (по id; первое побеждает).
      if (config.diagnostic) {
        const second = path.join(dir, 'workspace-diagnostic');
        await cp(path.join(root, 'corpus', work), second, { recursive: true });
        ctx.diagnostic = true;
        const extra = await context.run(ctx, async () => editMechanical(await openSource(second), loaded, pack, { mode: bench.edit.mode, noCache: true }));
        ctx.diagnostic = false;
        const ids = new Set(result.proposals.map((proposal) => proposal.id));
        const guard = (run: typeof result, pass: string) => (run.run.guard as { rejections: Array<Record<string, unknown>> }).rejections.map((item) => ({ ...item, pass }));
        const rejections = [...guard(result, 'production'), ...guard(extra, 'diagnostic')];
        result = { ...result, proposals: [...result.proposals, ...extra.proposals.filter((proposal) => !ids.has(proposal.id))],
          run: { ...result.run, guard: { ...(result.run.guard as object), rejections }, stages: [...(result.run.stages as unknown[]), ...(extra.run.stages as Array<Record<string, unknown>>).map((stage) => ({ ...stage, pass: 'diagnostic' }))] } };
        await rm(second, { recursive: true, force: true });
      }
      const elapsed = Date.now() - started;
      if (ctx.capHit) { await writeFile(path.join(dir, 'incomplete.json'), JSON.stringify({ job, reason: 'budget cap reached during the job; its results are not valid' }, null, 2)); throw new Error(`budget cap reached in ${job}; stopping`); }
      // Пайплайн записывает отказ провайдера как сбой окна и продолжает; для стенда такое задание недействительно.
      // 429 от OpenRouter (не успел проверить кредит) шлюз повторяет; такое задание действительно, только если пайплайн не записал ни сбоя окна, ни сбоя проверки.
      const failuresRecorded = (result.run.stages as Array<{ name: string; failures?: unknown[] }>).some((stage) => (stage.failures ?? []).length > 0)
        || ((result.run.guard as { rejections: Array<{ reason: string }> }).rejections).some((item) => String(item.reason).startsWith('verify failed'));
      const refused = ctx.calls.filter((call) => call.status !== 200 && !(call.status === 429 && !failuresRecorded));
      if (refused.length) { await writeFile(path.join(dir, 'incomplete.json'), JSON.stringify({ job, reason: `provider returned HTTP ${[...new Set(refused.map((call) => call.status))].join(',')}; results are not valid` }, null, 2)); throw new Error(`provider errors in ${job} (HTTP ${refused.map((call) => call.status).join(',')}); stopping`); }
      const accepted = await acceptProposals(source.editedDir, result.proposals, { acceptedBy: 'bench:accept-all' });
      const build = await buildEdited({ book: source.book, editedDir: source.editedDir, accepted, manifestText: source.manifestText });
      const edited: Record<string, string> = {};
      for (const chapter of source.book.chapters) edited[chapter.slug] = await readFile(path.join(source.editedDir, 'chapters', path.basename(chapter.file)), 'utf8').catch(() => chapter.text);
      await writeFile(path.join(dir, 'result.json'), `${JSON.stringify({ job, config, work, repeat, elapsed_ms: elapsed, scope: 'real editMechanical (rules + editor + deterministic guards + verifier, copy mode, no cache); final = offered proposals; build = all offered proposals accepted',
        stages: result.run.stages, proposals: result.proposals, rejections: (result.run.guard as { rejections: unknown[] }).rejections, build, edited, calls: ctx.calls.map(({ role, status, finish, cost, ms }) => ({ role, status, finish, cost, ms })) }, null, 2)}\n`);
      await rm(workspace, { recursive: true, force: true });
      console.log(JSON.stringify({ job, offered: result.proposals.length, rejected: ((result.run.guard as { rejections: unknown[] }).rejections).length, requests: ctx.calls.length, cost: Number(ctx.calls.reduce((sum, call) => sum + call.cost, 0).toFixed(5)), spent: Number(spent.toFixed(4)), seconds: Math.round(elapsed / 1000) }));
    }
  }
}

async function plan(): Promise<void> {
  const windows: Record<string, number> = {};
  for (const work of works()) { const dir = path.join(root, 'corpus', work); if (await exists(dir)) windows[work] = editWindows((await openSource(dir)).book, bench.edit.mode, bench.edit.context_budget).length; }
  const cases = (JSON.parse(await readFile(path.join(here, 'stage-a-cases.json'), 'utf8')) as { cases: unknown[] }).cases.length;
  console.log(JSON.stringify({ root, key_present: Boolean(process.env[keyEnv]), budget_usd: budget, spent_so_far: (await readJsonl(requestsFile())).reduce((sum, row) => sum + row.cost, 0),
    stage_a: { verifiers: bench.stage_a_verifiers, cases, max_calls: bench.stage_a_verifiers.length * cases * bench.verify.passes },
    stage_b: { configs: bench.stage_b.map((item) => item.id), works: bench.works, repeats: Number(flag('--repeats') ?? bench.repeats), editor_windows_per_job: windows } }, null, 2));
}

if (command === 'plan') await plan();
else if (command === 'corpus') { await mkdir(root, { recursive: true }); if (flag('--fixture')) await fixtureCorpus(flag('--fixture')!); else await buildCorpus(); }
else { await prepare(); if (command === 'stage-a') await (bench.stage_a_variants ? stageAVariants() : stageA()); else await stageB(); console.log(JSON.stringify({ spent: Number(spent.toFixed(6)), budget })); }
