// Stage 1 бенчмарка необходимости: метрики вариантов verifier по сохранённым ответам. Без вызовов моделей.
// node eval/bench/analyze-necessity.ts --out 2026-10-10-necessity-verifier/stage-1
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const amendeor = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const root = path.join(amendeor, 'eval/results', process.argv[process.argv.indexOf('--out') + 1]!);
const requests = (await readFile(path.join(root, 'requests.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)]! : null; };
type Row = { id: string; label: string; category: string; language: string; self_pairing: boolean; deterministic: string; decision: string; verify_failed: boolean; answers: Array<{ necessary?: boolean; preserved: boolean }>; cost: number; ms: number };
const variants: Array<{ variant: string; verifier: string; model: string; check: string; rows: Row[] }> = [];
for (const file of (await readdir(root)).filter((name) => name.endsWith('.json') && !name.startsWith('metrics') && !name.startsWith('deterministic'))) variants.push(JSON.parse(await readFile(path.join(root, file), 'utf8')));
variants.sort((a, b) => a.variant.localeCompare(b.variant));

// Проход = цепочка попыток шлюза до полного ответа; решение после k проходов — все k ответов «принять».
const ok = (answer: { necessary?: boolean; preserved: boolean }) => answer.preserved && answer.necessary !== false;
const decideAt = (row: Row, k: number) => row.answers.length >= k && row.answers.slice(0, k).every(ok) ? 'ACCEPT' : 'REJECT';
function passCosts(job: string): { cost: number[]; ms: number[] } {
  const calls = requests.filter((call) => call.job === job); const cost: number[] = [], ms: number[] = []; let c = 0, t = 0;
  for (const call of calls) { c += call.cost; t += call.ms ?? 0; if (call.status === 200 && call.finish !== 'length' && call.finish !== 'max_tokens') { cost.push(c); ms.push(t); c = 0; t = 0; } }
  if (c) { cost.push(c); ms.push(t); }
  return { cost, ms };
}
// Самопроверка исключается одинаково для обоих вариантов одного verifier, чтобы сравнение было на одном наборе.
const excluded = new Set(variants.flatMap((variant) => variant.rows.filter((row) => row.self_pairing).map((row) => `${variant.verifier}:${row.id}`)));
function metrics(variant: (typeof variants)[number], rows: Row[], k: number) {
  const at = rows.map((row) => ({ ...row, at: decideAt(row, k), costs: passCosts(`${variant.variant}/${row.id}`) }));
  const of = (label: string) => at.filter((row) => row.label === label);
  const acc = (list: typeof at) => list.filter((row) => row.at === 'ACCEPT');
  const rate = (part: number, whole: number) => whole ? Number((part / whole).toFixed(3)) : null;
  return {
    cases: at.length,
    valid_accepted: acc(of('ACCEPT')).length, valid_rejected: of('ACCEPT').filter((row) => row.at === 'REJECT').map((row) => row.id),
    harmful_accepted: acc(of('REJECT_HARMFUL')).map((row) => row.id), harmful_rejected: of('REJECT_HARMFUL').length - acc(of('REJECT_HARMFUL')).length,
    unnecessary_accepted: acc(of('REJECT_UNNECESSARY')).map((row) => row.id), unnecessary_rejected: of('REJECT_UNNECESSARY').length - acc(of('REJECT_UNNECESSARY')).length,
    ambiguous_accepted: acc(of('AMBIGUOUS')).map((row) => row.id),
    valid_acceptance_rate: rate(acc(of('ACCEPT')).length, of('ACCEPT').length), harmful_rejection_rate: rate(of('REJECT_HARMFUL').length - acc(of('REJECT_HARMFUL')).length, of('REJECT_HARMFUL').length),
    unnecessary_rejection_rate: rate(of('REJECT_UNNECESSARY').length - acc(of('REJECT_UNNECESSARY')).length, of('REJECT_UNNECESSARY').length),
    schema_failures: at.filter((row) => row.verify_failed && row.answers.length < k).length,
    cost_usd: Number(sum(at.map((row) => sum(row.costs.cost.slice(0, k)))).toFixed(6)), median_case_ms: median(at.map((row) => sum(row.costs.ms.slice(0, k))))
  };
}
const withRules = await readFile(path.join(root, 'deterministic-with-rules.json'), 'utf8').then((body) => JSON.parse(body) as Record<string, { with_rules: string }>, () => null);
const result: Record<string, unknown> = {};
for (const variant of variants) {
  const rows = variant.rows.filter((row) => !excluded.has(`${variant.verifier}:${row.id}`));
  // Путь производства: детерминированный слой вместе с предложениями правил (deterministic-with-rules.json), иначе — без них.
  const production = rows.filter((row) => withRules ? withRules[row.id]?.with_rules === 'passes' : row.deterministic === 'passes');
  const group = (key: 'language' | 'category' | 'label') => Object.fromEntries([...new Set(rows.map((row) => row[key]))].sort().map((value) => [value, { pass1: metrics(variant, rows.filter((row) => row[key] === value), 1), pass3: metrics(variant, rows.filter((row) => row[key] === value), 3) }]));
  const calls = requests.filter((call) => call.job.startsWith(`${variant.variant}/`));
  result[variant.variant] = { model: variant.model, check: variant.check, excluded_self_pairing: variant.rows.length - rows.length,
    all: { pass1: metrics(variant, rows, 1), pass3: metrics(variant, rows, 3) }, reaching_verifier: { cases: production.length, pass1: metrics(variant, production, 1), pass3: metrics(variant, production, 3) },
    by_language: group('language'), by_category: group('category'),
    requests: calls.length, truncated: calls.filter((call) => call.finish === 'length' || call.finish === 'max_tokens').length, provider_failures: calls.filter((call) => call.status !== 200).length,
    tokens_in: sum(calls.map((call) => call.usage?.prompt_tokens ?? call.usage?.input_tokens ?? 0)), tokens_out: sum(calls.map((call) => call.usage?.completion_tokens ?? call.usage?.output_tokens ?? 0)),
    reasoning_tokens: sum(calls.map((call) => call.usage?.completion_tokens_details?.reasoning_tokens ?? 0)), cached_tokens: sum(calls.map((call) => call.usage?.prompt_tokens_details?.cached_tokens ?? call.usage?.cache_read_input_tokens ?? 0)),
    cost_usd: Number(sum(calls.map((call) => call.cost)).toFixed(6)), cost_sources: [...new Set(calls.map((call) => call.cost_source))] };
}
await writeFile(path.join(root, 'metrics.json'), `${JSON.stringify({ generated_at: new Date().toISOString(), spent_usd: Number(sum(requests.map((call) => call.cost)).toFixed(6)), variants: result }, null, 2)}\n`);
for (const [name, value] of Object.entries(result) as Array<[string, any]>) for (const k of ['pass1', 'pass3']) {
  const m = value.all[k], r = value.reaching_verifier[k];
  console.log(`${name.padEnd(24)} ${k} | valid ${m.valid_accepted}/${m.valid_accepted + m.valid_rejected.length} | harmful acc ${m.harmful_accepted.length} | unnec acc ${m.unnecessary_accepted.length}/${m.unnecessary_accepted.length + m.unnecessary_rejected} | amb acc ${m.ambiguous_accepted.length} | schema ${m.schema_failures} | $${m.cost_usd} | reach: harmful ${r.harmful_accepted.length} unnec ${r.unnecessary_accepted.length} valid-rej ${r.valid_rejected.length}/${r.cases}`);
}
