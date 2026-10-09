// Оценка английских гайдов на размеченной фикстуре eval/fixtures/en-guides.
// Без флагов — только узкие сигналы и базовая линия без новых гайдов (formulaic), без сети.
// С --model — ещё и контекстный проход каждого гайда на моделях из amendeor.yaml; стоимость берётся из ledger.
//   node --env-file=.env eval/en-guides.ts [--model] [--label name]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSource } from '../src/source/index.ts';
import { loadPack } from '../src/lang/pack.ts';
import { loadConfig } from '../src/config.ts';
import { checkGuide, dedupeFindings } from '../src/checks/guide.ts';
import { checkGuideContextual } from '../src/checks/guide-context.ts';
import { englishGuides } from '../src/checks/en-guides.ts';
import { scanFormulaicProse } from '../src/patterns/formulaic.ts';

interface Labels { defects: Array<{ scene: string; guide: string; principle: string; fragment: string }>; keep: Record<string, string> }
interface Hit { guide: string; source: 'signal' | 'contextual' | 'formulaic'; principle: string; scene: string; start: number; end: number; quote: string; reason?: string }
type Verdict = 'tp' | 'near' | 'fp-keep' | 'unlabeled';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDir = path.join(root, 'eval/fixtures/en-guides');
const withModel = process.argv.includes('--model');
const labelIndex = process.argv.indexOf('--label');
const label = labelIndex >= 0 ? process.argv[labelIndex + 1]! : '';

const labels = JSON.parse(await readFile(path.join(fixtureDir, 'labels.json'), 'utf8')) as Labels;
const source = await openSource(path.join(fixtureDir, 'passages.md'), { lang: 'en', out: path.join(os.tmpdir(), 'amendeor-en-guides-eval') });
const pack = (await loadPack('en')).pack;
const scenes = new Map(source.book.chapters[0]!.scenes.map((scene) => [scene.id, scene.text]));
const defects = labels.defects.map((item) => {
  const text = scenes.get(item.scene);
  const start = text?.indexOf(item.fragment) ?? -1;
  if (start < 0) throw new Error(`label fragment not found in ${item.scene}: ${item.fragment}`);
  return { ...item, start, end: start + item.fragment.length };
});

function verdict(hit: Hit): Verdict {
  if (hit.scene in labels.keep) return 'fp-keep';
  const overlapping = defects.filter((item) => item.scene === hit.scene && hit.start < item.end && hit.end > item.start);
  if (overlapping.some((item) => item.principle === hit.principle)) return 'tp';
  return overlapping.length ? 'near' : 'unlabeled';
}

function score(hits: Hit[], guide?: string) {
  const scoped = defects.filter((item) => !guide || item.guide === guide);
  const verdicts = hits.map((hit) => ({ ...hit, verdict: verdict(hit) }));
  const count = (kind: Verdict) => verdicts.filter((item) => item.verdict === kind).length;
  const found = scoped.filter((item) => hits.some((hit) => hit.scene === item.scene && hit.principle === item.principle && hit.start < item.end && hit.end > item.start));
  const tp = count('tp'), fp = count('fp-keep'), unlabeled = count('unlabeled'), near = count('near');
  return {
    findings: hits.length, tp, near, fp_on_keep: fp, unlabeled,
    // Нижняя граница точности считает неразмеченные находки ошибками, верхняя — верными; «near» — место верное, принцип другой.
    precision_lower: hits.length ? tp / hits.length : null,
    precision_upper: hits.length ? (tp + near + unlabeled) / hits.length : null,
    recall: scoped.length ? found.length / scoped.length : null,
    missed: scoped.filter((item) => !found.includes(item)).map((item) => `${item.scene} ${item.principle}`),
    hits: verdicts.map((item) => ({ guide: item.guide, source: item.source, principle: item.principle, scene: item.scene, quote: item.quote, verdict: item.verdict, reason: item.reason }))
  };
}

const formulaic: Hit[] = scanFormulaicProse(source.book, pack).map((hit) => ({ guide: 'formulaic', source: 'formulaic', principle: hit.id, scene: hit.scene, start: hit.start, end: hit.end, quote: hit.quote }));
const baselineDefects = defects.filter((item) => formulaic.some((hit) => hit.scene === item.scene && hit.start < item.end && hit.end > item.start));
const report: Record<string, unknown> = {
  date: new Date().toISOString().slice(0, 10), fixture: 'eval/fixtures/en-guides', defects: defects.length, keep_scenes: Object.keys(labels.keep).length,
  baseline_without_guides: { formulaic_hits: formulaic.length, defects_touched: baselineDefects.length, fp_on_keep: formulaic.filter((hit) => hit.scene in labels.keep).length, hits: formulaic.map((hit) => `${hit.scene} ${hit.principle} «${hit.quote}»`) },
  guides: {} as Record<string, unknown>
};
const all: Hit[] = [];
let totalCost = 0, totalIn = 0, totalOut = 0;
const loaded = withModel ? await loadConfig({ workspaceDir: root }) : undefined;
for (const guide of englishGuides) {
  const signals: Hit[] = checkGuide(guide, source.book, pack).map((item) => ({ guide: guide.id, source: 'signal', principle: item.principle, scene: item.scene, start: item.start, end: item.end, quote: item.quote }));
  const entry: Record<string, unknown> = { signals: score(signals, guide.id) };
  if (loaded) {
    loaded.config.language = 'en';
    const result = await checkGuideContextual(guide, source.book, pack, loaded, source.stateDir, true);
    const contextual: Hit[] = result.findings.map((item) => ({ guide: guide.id, source: 'contextual', principle: item.principle, scene: item.scene, start: item.start, end: item.end, quote: item.quote, reason: item.reason }));
    const combined = dedupeFindings([...signals, ...contextual].map((item) => ({ ...item, id: item.principle, chapter: 'passages', source_pages: '', provenance: '', reason: item.reason ?? '', guide: guide.id as never }))).map((item) => ({ ...item, guide: guide.id })) as Hit[];
    const cost = result.ledger.reduce((sum, item) => sum + (item.cost ?? 0), 0);
    totalCost += cost; totalIn += result.ledger.reduce((sum, item) => sum + item.tokens_in, 0); totalOut += result.ledger.reduce((sum, item) => sum + item.tokens_out, 0);
    entry.contextual = { status: result.status, windows: result.windows, calls: result.ledger.length, failures: result.failures, discarded: result.discarded.length, cost_usd: Number(cost.toFixed(4)), ...score(contextual, guide.id) };
    entry.combined = score(combined, guide.id);
    all.push(...combined);
  } else all.push(...signals);
  (report.guides as Record<string, unknown>)[guide.id] = entry;
}
report.all_guides = { ...score(all), hits: undefined };
if (withModel) report.cost = { usd: Number(totalCost.toFixed(4)), tokens_in: totalIn, tokens_out: totalOut, edit_model: loaded!.config.profiles.edit?.model, verify_model: loaded!.config.profiles.verify?.model, verify_passes: loaded!.config.profiles.verify?.passes };

const name = `${report.date}-en-guides${withModel ? '-model' : '-signals'}${label ? `-${label}` : ''}`;
await mkdir(path.join(root, 'eval/results'), { recursive: true });
await writeFile(path.join(root, 'eval/results', `${name}.json`), `${JSON.stringify(report, null, 2)}\n`);
const pct = (value: unknown) => typeof value === 'number' ? `${Math.round(value * 100)}%` : '—';
const lines = [`# English guides evaluation ${report.date}${withModel ? ' (model)' : ' (signals only)'}`, '',
  `Fixture: ${defects.length} labeled defects in 13 scenes, ${Object.keys(labels.keep).length} scenes of legitimate stylistic choices.`, '',
  `Baseline without the new guides (formulaic catalog): ${formulaic.length} hits, ${baselineDefects.length} labeled defects touched, ${(report.baseline_without_guides as { fp_on_keep: number }).fp_on_keep} on keep scenes.`, '',
  '| Guide | Layer | Findings | TP | Near | FP on keep | Unlabeled | Precision (lower–upper) | Recall |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |'];
for (const [id, entry] of Object.entries(report.guides as Record<string, Record<string, ReturnType<typeof score>>>)) {
  for (const layer of ['signals', 'contextual', 'combined'] as const) {
    const item = entry[layer]; if (!item) continue;
    lines.push(`| ${id} | ${layer} | ${item.findings} | ${item.tp} | ${item.near} | ${item.fp_on_keep} | ${item.unlabeled} | ${pct(item.precision_lower)}–${pct(item.precision_upper)} | ${pct(item.recall)} |`);
  }
}
if (withModel) lines.push('', `Cost: $${(report.cost as { usd: number }).usd} (${totalIn} tokens in, ${totalOut} out); editor ${loaded!.config.profiles.edit?.model}, verifier ${loaded!.config.profiles.verify?.model} × ${loaded!.config.profiles.verify?.passes ?? 1}.`);
lines.push('', 'Findings by verdict are in the JSON next to this file.');
await writeFile(path.join(root, 'eval/results', `${name}.md`), `${lines.join('\n')}\n`);
process.stdout.write(`${lines.join('\n')}\n`);
