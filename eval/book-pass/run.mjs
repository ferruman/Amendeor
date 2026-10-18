#!/usr/bin/env node
// node eval/book-pass/run.mjs [--book eleven-days|furnace-road] [--model openai/gpt-6-luna] [--dry]
//
// Корректорское чтение всей книги за один вызов, с оценкой по keys.json — языковым замечаниям двух независимых
// редакторских ревью. Amendeor правит окно за окном и потому не видит ни ляпа, который виден только по смыслу
// абзаца («ritual» — четыре слога, чашки на сковородке), ни оборота, на который опирается вся книга
// («forty-five years», 60 раз). На Eleven Days он исправил три опечатки и отметил 39 сравнений «the way a…».
// Корпус и счётчик берутся из процедурного бенчмарка Collationator. `--dry` печатает размеры и ничего не спрашивает.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const opt = (name, dflt) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : dflt);
const DIR = fileURLToPath(new URL('.', import.meta.url));
const SCORER = join(DIR, '../../../Collationator/eval/procedural/score.js');
const MODEL = opt('--model', 'openai/gpt-6-luna');
const only = opt('--book', null);

const SYSTEM = `You are the copy editor of a publishing house. You have read the complete novel below, and before it goes to proofs you mark what a careful line and copy editor marks — the language, not the plot.

Two kinds of problem.
1. Slips that only the sense of the passage reveals: a word that cannot mean what the sentence needs (an object that cannot do what it does, a term used wrongly for its context), a count or description of language that is wrong ("four syllables" for a three-syllable word, "twice" before three items), clock or number arithmetic inside a sentence, a line of dialogue with no clear speaker or the wrong form of address, a pronoun that gives a character the wrong gender, a sentence or paragraph that contradicts itself, a stock phrase that does not fit the character it describes.
2. The book's verbal habits: words, phrases, similes, gestures and sentence frames repeated so often across the book that they turn mechanical ("the way…", a recurring number, a gesture every character makes). Name the habit, estimate how often it occurs, quote one occurrence, and say which uses to keep.

Do not mark: dialect or nonstandard grammar in dialogue that renders speech, a refrain the book clearly builds on purpose, matters of plot, continuity across chapters or legal accuracy (other readers do that), or a preference the text does not violate.

Be exhaustive: a careful copy edit of a novel marks many slips and several habits. Do not pad.

Reply with JSON only: { "marks": [{ "kind": "slip|habit", "chapter": "<id>", "quote": "<one sentence copied character for character>", "problem": "…", "fix": "the minimal correction, or for a habit which uses to cut", "count": <estimated occurrences, habits only> }] }`;

function apiKey(yaml) {
  const block = yaml.split(/\n(?=\s{2}\S[^\n]*:\s*\n)/).find((b) => /openrouter-luna:/.test(b)) ?? yaml;
  return block.match(/api_key:\s*(\S+)/)?.[1];
}

const { loadBench, score, summarize } = await import(SCORER);
const books = await loadBench(join(DIR, 'keys.json'));
const key = apiKey(await readFile(join(homedir(), '.config/codicora/esgardeor.yaml'), 'utf8'));
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
await mkdir(join(DIR, 'results'), { recursive: true });
let spent = 0;
for (const b of Object.values(books)) {
  if (only && b.name !== only) continue;
  const user = b.audited.chapters.map((c) => `=== ${c.slug} · ${c.title ?? ''} ===\n\n${c.text}`).join('\n\n');
  console.error(`${b.name}: ${user.length} chars ≈ ${Math.round(user.length / 4)} tokens`);
  if (argv.includes('--dry')) continue;
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: MODEL, max_tokens: 32_000, reasoning: { enabled: true }, temperature: 0, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }] }),
    signal: AbortSignal.timeout(900_000),
  });
  if (!res.ok) throw new Error(`${b.name}: model ${res.status} ${await res.text()}`);
  const body = await res.json();
  spent += body.usage?.cost ?? 0;
  const raw = body.choices?.[0]?.message?.content ?? '';
  const marks = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)).marks ?? [];
  const findings = marks.map((m) => ({ chapterSlug: m.chapter, quote: { text: m.quote ?? '' }, summary: `${m.kind}: ${m.problem ?? ''}`, suggestion: m.fix, severity: 'medium' }));
  const s = score(b, findings);
  const result = { model: MODEL, usage: body.usage, marks: marks.length, slips: marks.filter((m) => m.kind === 'slip').length, habits: marks.filter((m) => m.kind === 'habit').length, ...summarize(s.issues), unmatched: s.unmatched, falsePositives: s.falsePositives, issues: s.issues.map((i) => `${i.id}:${i.reasoned ? 'R' : i.located ? 'L' : '-'}`).join(' ') };
  await writeFile(join(DIR, 'results', `${stamp}-${b.name}.json`), JSON.stringify({ ...result, raw: marks }, null, 1));
  console.log(JSON.stringify({ book: b.name, ...result }, null, 1));
}
console.error(`spent $${spent.toFixed(4)}`);
