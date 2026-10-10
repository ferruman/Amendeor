import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parse } from 'yaml';
import { loadConfig } from '../src/config.ts';
import { openSource } from '../src/source/index.ts';
import { loadPack } from '../src/lang/pack.ts';
import { editMechanical } from '../src/edit/mechanical.ts';
import { buildEdited } from '../src/edited/build.ts';

// Один исходный файл, отдельная копия, ни одного вызова accept; жёсткий бюджет охватывает и повторы.
const [inputArg, outputArg] = process.argv.slice(2);
if (!inputArg || !outputArg) throw new Error('usage: node --env-file-if-exists=.env scripts/supervised-trial.ts <chapter.md> <new-output-directory>');
const input = path.resolve(inputArg), output = path.resolve(outputArg);
if (!/\.(md|txt)$/i.test(input)) throw new Error('one manuscript chapter file is required');
if (output.startsWith(path.dirname(input) + path.sep)) throw new Error('validation output must be outside the source manuscript');
await mkdir(path.dirname(output), { recursive: true });
await mkdir(output, { recursive: false });
const started = performance.now();
const digest = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
async function snapshot(dir: string): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) Object.assign(hashes, await snapshot(file));
    else if (item.isFile()) hashes[file] = digest(await readFile(file));
  }
  return hashes;
}
const originalRoot = path.dirname(input).endsWith('chapters') ? path.dirname(path.dirname(input)) : path.dirname(input);
const before = await snapshot(originalRoot);
const text = await readFile(input, 'utf8');
const copy = path.join(output, path.basename(input));
await writeFile(copy, text);
const production = parse(await readFile(new URL('../amendeor.yaml', import.meta.url), 'utf8'));
const loaded = await loadConfig({ cli: production });
const source = await openSource(copy, { lang: 'en', out: path.join(output, 'edited') });
const language = await loadPack('en');
const nativeFetch = globalThis.fetch;
const catalog = (await (await nativeFetch('https://openrouter.ai/api/v1/models')).json() as any).data;
for (const name of ['edit', 'verify']) {
  const profile = loaded.config.profiles[name]!;
  const model = catalog.find((item: any) => item.id === profile.model);
  if (!model) throw new Error('model unavailable: ' + profile.model);
  if (name === 'verify' && !model.reasoning?.supported_efforts?.includes(profile.reasoning_effort)) throw new Error('reasoning effort unsupported');
  const configured = loaded.config.providers[profile.provider]!.price!;
  if (Math.abs(Number(model.pricing.prompt) * 1e6 - configured.input_per_m) > 1e-12 || Math.abs(Number(model.pricing.completion) * 1e6 - configured.output_per_m) > 1e-12) throw new Error('pricing snapshot changed');
}
await writeFile(path.join(output, 'pricing.json'), JSON.stringify({ at: new Date().toISOString(), models: catalog.filter((item: any) => ['openai/gpt-6-luna', 'anthropic/claude-haiku-5.5'].includes(item.id)) }, null, 2));
let actual = 0, chargedBound = 0, blocked = false;
const calls: any[] = [];
globalThis.fetch = (async (url, init) => {
  if (String(url) !== 'https://openrouter.ai/api/v1/chat/completions') throw new Error('unexpected paid endpoint');
  const request = JSON.parse(String(init?.body));
  const role = request.model === loaded.config.profiles.edit!.model ? 'editor' : request.model === loaded.config.profiles.verify!.model ? 'verifier' : null;
  if (!role) throw new Error('unexpected model');
  const model = catalog.find((item: any) => item.id === request.model);
  // Все символы считаются токенами; цены для длинного контекста тоже учтены.
  const prices = [model.pricing, ...(model.pricing.overrides ?? [])];
  const inPrice = Math.max(...prices.map((p: any) => Number(p.prompt)));
  const outPrice = Math.max(...prices.map((p: any) => Number(p.completion)));
  const worst = JSON.stringify(request).length * inPrice + request.max_tokens * outPrice;
  if (blocked || chargedBound + worst > 0.50) { blocked = true; throw new Error('trial $0.50 budget exhausted; no further calls'); }
  chargedBound += worst;
  const start = performance.now();
  try {
    const response = await nativeFetch(url, init); const raw = await response.text();
    let body: any; try { body = JSON.parse(raw); } catch { body = null; }
    const cost = body?.usage?.cost;
    if (typeof cost === 'number' && Number.isFinite(cost) && cost >= 0) { actual += cost; chargedBound += cost - worst; }
    else { blocked = true; }
    const record = { role, request, response: body ?? raw, status: response.status, cost: typeof cost === 'number' ? cost : null, reserved: worst, ms: Math.round(performance.now() - start) };
    calls.push(record);
    await writeFile(path.join(output, 'requests.jsonl'), calls.map(x => JSON.stringify(x)).join('\n') + '\n');
    return new Response(raw, { status: response.status, headers: response.headers });
  } catch (error) {
    blocked = true;
    calls.push({ role, request, error: String(error), cost: null, reserved: worst });
    await writeFile(path.join(output, 'requests.jsonl'), calls.map(x => JSON.stringify(x)).join('\n') + '\n');
    throw error;
  }
}) as typeof fetch;
let result;
try { result = await editMechanical(source, loaded, language, { mode: 'copy', noCache: true }); }
finally { globalThis.fetch = nativeFetch; }
const built = await buildEdited({ book: source.book, editedDir: source.editedDir, accepted: [] });
const after = await snapshot(originalRoot);
if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('original manuscript hashes changed');
const guard = result.run.guard as any;
const rows: any[] = result.proposals.map(p => ({ id: p.id, chapter: p.location.chapter, scene: p.location.scene, original: p.target.text, replacement: p.replacement, category: p.category, source: p.source, verifier: (guard.verifications ?? []).find((v: any) => v.proposal_id === p.id)?.answers ?? 'not called (deterministic rule)', status: 'PENDING_HUMAN_REVIEW' }));
for (const p of guard.rejections) rows.push({ id: p.proposal_id, chapter: p.chapter, scene: p.scene, original: p.target, replacement: p.replacement, category: p.category, source: p.source, verifier: (guard.verifications ?? []).find((v: any) => v.proposal_id === p.proposal_id)?.answers ?? 'not called (deterministic rejection)', status: 'REJECTED', rejection: p.reason, guard: p.guard });
// Сырые предложения, отброшенные парсером, не теряются при проверке человеком.
for (const call of calls.filter(c => c.role === 'editor')) {
  try {
    const edits = JSON.parse(call.response.choices[0].message.content).edits ?? [];
    for (const p of edits) if (!rows.some(r => r.original === p.target && r.replacement === p.replacement)) rows.push({ chapter: path.basename(input), scene: 'see request window', original: p.target, replacement: p.replacement, category: p.category, source: 'model', verifier: 'not called (parsing/model pass)', status: 'DISCARDED', rejection: 'See model-stage discarded diagnostics in run.json' });
  } catch { /* Ошибка JSON отражена в run.json и requests.jsonl. */ }
}
const words = (result.run.summary as { words: number }).words;
const summary = { run_id: result.run_id, input, source_sha256: digest(text), manuscript_hashes: before, original_unchanged: true, scenes: source.book.chapters.flatMap(c => c.scenes).length, words, model_proposals: rows.filter(r => r.source === 'model').length, rule_proposals: rows.filter(r => r.source.startsWith('rule:')).length, pending: rows.filter(r => r.status === 'PENDING_HUMAN_REVIEW').length, accepted: 0, rejected: rows.filter(r => r.status !== 'PENDING_HUMAN_REVIEW').length, build_conflicts: built.filter(item => item.status === 'conflict').length, verifier_calls: calls.filter(c => c.role === 'verifier').length, api_calls: calls.length, actual_api_cost: actual, conservative_spend_bound: chargedBound, budget_usd: 0.50, cost_per_1000_words: actual / words * 1000, execution_ms: Math.round(performance.now() - started), blocked, stages: result.run.stages };
await writeFile(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
await writeFile(path.join(output, 'review.json'), JSON.stringify(rows, null, 2) + '\n');
let report = '# Furnace Road supervised trial\n\n' + 'All offered edits remain pending. No acceptance API was called. The build used an empty acceptance list.\n\n```json\n' + JSON.stringify({ ...summary, manuscript_hashes: undefined, stages: undefined }, null, 2) + '\n```\n\n';
for (const row of rows) report += '## ' + row.chapter + ' / ' + row.scene + '\n\n' + '- Category: ' + row.category + '\n- Source: ' + row.source + '\n- Status: ' + row.status + '\n- Verifier decisions: ' + JSON.stringify(row.verifier) + '\n- Rejection: ' + (row.rejection ?? 'none') + '\n- Manual inspection: inspect proper names, dialogue, regional/historical spelling, content words, chronology, causality, restructuring and semantic drift in the full scene.\n\nOriginal:\n\n```text\n' + row.original + '\n```\n\nReplacement:\n\n```text\n' + row.replacement + '\n```\n\n';
await writeFile(path.join(output, 'review.md'), report);
console.log(JSON.stringify({ ...summary, manuscript_hashes: undefined, stages: undefined }));
if (blocked || (result.run.stages as any[]).some(s => s.status === 'failed' || s.failures?.length)) process.exitCode = 1;
