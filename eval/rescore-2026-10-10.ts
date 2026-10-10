// Пересчёт сохранённых предложений 2026-10-10 по политике и текущим детерминированным фильтрам. Без вызовов моделей.
// Исторические файлы только читаются; результат пишется в eval/results/2026-10-10-policy-rescore/.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { deterministicGuard } from '../src/guard/index.ts';
import { loadPack } from '../src/lang/pack.ts';
import { configSchema } from '../src/config.ts';
import { enabledRules, ruleContext } from '../src/rules/index.ts';
import { makeProposal } from '../src/proposal/identity.ts';
import { wholeWords } from '../src/edit/mechanical.ts';
import type { Proposal } from '../src/proposal/schema.ts';
import type { Book } from '../src/book.ts';
import { withPolicy, type Mutation } from './mutate.ts';
import { scoreByPolicy, type Judgement } from './score.ts';

const results = new URL('./results/', import.meta.url);
const out = new URL('./2026-10-10-policy-rescore/', results);
const judgements = (JSON.parse(await readFile(new URL('./labels/edit-judgements-2026-10-10.json', import.meta.url), 'utf8')) as { judgements: Judgement[] }).judgements;
const config = configSchema.parse({ preserve: [] });
// verify.passes в amendeor.yaml; все модельные правки copy-режима — prose.
const passes = 3;

function ruleProposals(book: Book, lang: string, pack: Awaited<ReturnType<typeof loadPack>>['pack']): Proposal[] {
  return book.chapters.flatMap((chapter) => chapter.scenes.flatMap((scene) => enabledRules(config, lang).flatMap((rule) => rule.detect(scene, ruleContext(book, config, pack, scene)).map((raw) => wholeWords(scene.text, raw)).map((draft) =>
    makeProposal({ chapter: chapter.slug, scene: scene.id, category: draft.category ?? rule.category, impact: rule.impact, target: draft.target, replacement: draft.replacement, sceneText: scene.text, source: `rule:${rule.id}` })))));
}

const rows = [];
for (const series of ['2026-10-10-model-comparison', '2026-10-10-haiku-medium']) {
  const dir = new URL(`./${series}/`, results);
  const corpus = JSON.parse(await readFile(new URL('corpus.json', dir), 'utf8')) as Array<{ work: string; book: Book; mutations: Mutation[] }>;
  for (const file of (await readdir(dir)).filter((name) => /-(ru|en)-[01]\.json$/.test(name)).sort()) {
    const run = JSON.parse(await readFile(new URL(file, dir), 'utf8')) as { model: string; repeat: number; work: string; proposals: Proposal[] };
    const set = corpus.find((item) => item.work === run.work)!;
    const lang = run.work.endsWith('-ru') ? 'ru' : 'en';
    const pack = (await loadPack(lang)).pack;
    const mutations = withPolicy(set.book, set.mutations, pack, 'copy');
    const rules = ruleProposals(set.book, lang, pack);
    const sceneOf = (proposal: Proposal) => set.book.chapters.find((chapter) => chapter.slug === proposal.location.chapter)!.scenes.find((scene) => scene.id === proposal.location.scene)!.text;
    for (const scenario of ['model-only', 'model+rules'] as const) {
      const preferred = scenario === 'model+rules' ? rules : [];
      const rejected: Array<{ proposal_id: string; guard: string; reason: string }> = []; const passed: Proposal[] = [];
      for (const proposal of run.proposals) {
        const check = deterministicGuard(proposal, sceneOf(proposal), set.book, pack, config, 'copy', preferred);
        if ('guard' in check) rejected.push({ proposal_id: proposal.id, guard: check.guard, reason: check.reason }); else passed.push(proposal);
      }
      // Правила не проходят verifier; в final они входят как есть.
      const candidates = [...run.proposals, ...preferred], final = [...passed, ...preferred];
      const score = scoreByPolicy(set.book, mutations, candidates, final, rejected, judgements);
      rows.push({ series, model: run.model + (series.endsWith('haiku-medium') ? ' @medium' : ''), work: run.work, repeat: run.repeat, scenario, stage_final: 'after deterministic filters; model verifier NOT run',
        verifier_calls_upper_bound: passed.length * passes, voice_rejected_before_verifier: rejected.filter((item) => item.guard === 'voice').length, rule_preferred: rejected.filter((item) => item.guard === 'rule-preferred').length,
        counts: score.counts, rejections: { correct: score.rejections.correct, incorrect: score.rejections.incorrect, ambiguous: score.rejections.ambiguous, unlabelled: score.rejections.unlabelled }, mutations: score.mutations, rejection_items: score.rejections.items });
    }
  }
}
const sum = (items: typeof rows, pick: (row: (typeof rows)[number]) => number) => items.reduce((total, row) => total + pick(row), 0);
const summary = [...new Set(rows.map((row) => `${row.model}|${row.scenario}`))].map((key) => {
  const [model, scenario] = key.split('|'); const own = rows.filter((row) => row.model === model && row.scenario === scenario);
  const counts = Object.fromEntries(Object.keys(own[0]!.counts).map((name) => [name, sum(own, (row) => row.counts[name as keyof typeof row.counts])]));
  return { model, scenario, runs: own.length, ...counts, rejections_correct: sum(own, (row) => row.rejections.correct), rejections_incorrect: sum(own, (row) => row.rejections.incorrect), rejections_ambiguous: sum(own, (row) => row.rejections.ambiguous), rejections_unlabelled: sum(own, (row) => row.rejections.unlabelled), verifier_calls_upper_bound: sum(own, (row) => row.verifier_calls_upper_bound), rule_preferred: sum(own, (row) => row.rule_preferred) };
});
await mkdir(out, { recursive: true });
await writeFile(new URL('summary.json', out), `${JSON.stringify({ generated_from: ['2026-10-10-model-comparison', '2026-10-10-haiku-medium'], judgements: 'eval/labels/edit-judgements-2026-10-10.json (status: proposed)', note: 'final = after current deterministic filters; the model verifier was not run in these series', summary, rows }, null, 2)}\n`);
console.table(summary.map(({ model, scenario, total, reachable, detected, exact, alternative, partial, incorrect, harmful, policy_compliant, final_policy_compliant, final_harmful, rejections_incorrect, verifier_calls_upper_bound }) => ({ model, scenario, total, reachable, detected, exact, alternative, partial, incorrect, harmful, policy_compliant, final_policy_compliant, final_harmful, rejections_incorrect, verifier_calls_upper_bound })));
