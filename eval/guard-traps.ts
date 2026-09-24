import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPack } from '../src/lang/pack.ts';
import { semanticTrap } from '../src/guard/traps.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function runTrapEvaluation(): Promise<{ json: string; markdown: string }> {
  const results: Record<string, { language: string; total: number; rejected: number; recall: number; per_type: Record<string, { total: number; rejected: number; recall: number }>; missed: string[] }> = {};
  for (const [work, language] of [['jekyll-en', 'en'], ['kashtanka-ru', 'ru']] as const) {
    const traps = (JSON.parse(await readFile(path.join(root, 'eval/fixtures', work, 'traps.json'), 'utf8')) as { traps: Array<{ id: string; type: string; before: string; after: string }> }).traps;
    const pack = (await loadPack(language)).pack;
    const perType: Record<string, { total: number; rejected: number; recall: number }> = {};
    const missed: string[] = []; let rejected = 0;
    for (const trap of traps) {
      const group = perType[trap.type] ?? { total: 0, rejected: 0, recall: 0 };
      group.total++;
      if (semanticTrap(trap.before, trap.after, pack)) { group.rejected++; rejected++; } else missed.push(trap.id);
      group.recall = group.rejected / group.total;
      perType[trap.type] = group;
    }
    results[work] = { language, total: traps.length, rejected, recall: rejected / traps.length, per_type: perType, missed };
  }
  const dir = path.join(root, 'eval/results'); await mkdir(dir, { recursive: true });
  const stem = new Date().toISOString().slice(0, 10) + '-guard-traps';
  const json = path.join(dir, stem + '.json'), markdown = path.join(dir, stem + '.md');
  await writeFile(json, JSON.stringify({ schema: 'amendeor.guard-traps/0.1', generated_at: new Date().toISOString(), kind: 'deterministic-trap-stage-only', results }, null, 2) + '\n');
  const lines = ['# Deterministic semantic trap evaluation', '', 'This measures the first guard stage on the 160 prepared meaning-change pairs per language. It is not a real-provider edit evaluation.', '', '| Type | EN | RU |', '| --- | ---: | ---: |'];
  const en = results['jekyll-en']!, ru = results['kashtanka-ru']!;
  for (const type of Object.keys(en.per_type)) lines.push('| ' + type + ' | ' + en.per_type[type]!.rejected + '/' + en.per_type[type]!.total + ' | ' + ru.per_type[type]!.rejected + '/' + ru.per_type[type]!.total + ' |');
  lines.push('| Overall | ' + en.rejected + '/' + en.total + ' | ' + ru.rejected + '/' + ru.total + ' |', '');
  await writeFile(markdown, lines.join('\n'));
  return { json, markdown };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await runTrapEvaluation()));
