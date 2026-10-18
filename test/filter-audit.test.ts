import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { openSource } from '../src/source/index.ts';
import { loadConfig } from '../src/config.ts';
import { loadPack } from '../src/lang/pack.ts';
import { editMechanical } from '../src/edit/mechanical.ts';
import { acceptProposals } from '../src/edited/decisions.ts';
import { buildEdited } from '../src/edited/build.ts';
import { makeProposal } from '../src/proposal/identity.ts';
import { guardProposals } from '../src/guard/index.ts';
import { splitScenes, type Book } from '../src/book.ts';
import { scoreProposals } from '../eval/score.ts';

// Аудит фильтров 2026-10-10: ../../codicora-docs/audits/2026-10-10-amendeor/amendeor-filter-audit-2026-10-10.md.

for (const [lang, text, expected] of [
  ['ru', 'Он ждал.\n\n- Тётка, пойдём, — сказал хозяин.\n\nОн пришёл - она ушла.\n', 'Он ждал.\n\n— Тётка, пойдём, — сказал хозяин.\n\nОн пришёл — она ушла.\n'],
  ['en', 'He came - she left.\n\nA word  follows.\n\nStop , now.\n', 'He came — she left.\n\nA word follows.\n\nStop, now.\n']
] as const) test(`FA-1 ${lang}: dash and whitespace rule edits locate and apply instead of going stale`, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'amendeor-audit-'));
  try {
    const manuscript = path.join(dir, 'book.md');
    await writeFile(manuscript, text);
    const source = await openSource(manuscript, { lang, out: path.join(dir, 'out') });
    const result = await editMechanical(source, await loadConfig({ env: { HOME: dir } }), await loadPack(lang), { mode: 'mechanical' });
    const typography = result.proposals.filter((item) => item.source === 'rule:typography.dashes-ellipsis' || item.source === 'rule:typography.whitespace');
    assert.equal(typography.length, lang === 'ru' ? 2 : 3, JSON.stringify(typography.map((item) => item.target.text)));
    const built = await buildEdited({ book: source.book, editedDir: source.editedDir, accepted: await acceptProposals(source.editedDir, typography, { acceptedBy: 'human:cli' }) });
    assert.ok(built.every((item) => item.status === 'applied'), JSON.stringify(built));
    assert.equal(await readFile(path.join(source.editedDir, 'chapters/book.md'), 'utf8'), expected);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

function bookWith(text: string, lang: string): Book { return { lang, chapters: [{ slug: 'one', title: 'One', file: 'one.md', text, scenes: splitScenes(text) }] }; }

test('FA-2: a target that reaches into narration does not lift the dialogue protection', async () => {
  const text = 'He turned. “I is going home,” he sayd.';
  const book = bookWith(text, 'en'); const scene = book.chapters[0]!.scenes[0]!;
  const proposal = (target: string, replacement: string) => makeProposal({ chapter: 'one', scene: scene.id, category: 'grammar', target, replacement, sceneText: scene.text, source: 'model', unverified: true });
  const source = { book, stateDir: await mkdtemp(path.join(os.tmpdir(), 'amendeor-audit-')) } as never;
  const loaded = await loadConfig({ env: { HOME: os.tmpdir() } });
  // Без профиля verify всё, что прошло детерминированные ловушки, отклоняет verifier — так видно, какой слой сработал.
  const guard = await guardProposals(source, loaded, await loadPack('en'), [
    proposal('He turned. “I is going', 'He turned. “I am going'),
    proposal('“I is', '“I am'),
    proposal('home,” he sayd.', 'home,” he said.')
  ], true);
  assert.deepEqual(guard.rejected.map((item) => [item.guard, item.reason]), [
    ['semantic-trap', 'dialogue-content-change'],
    ['semantic-trap', 'dialogue-content-change'],
    ['semantic-verifier', 'verify profile missing']
  ]);
  assert.deepEqual(guard.rejected.map((item) => [item.target, item.replacement]).at(0), ['He turned. “I is going', 'He turned. “I am going']);
});

test('FA-3: the scorer separates exact restoration from any change to the mutated span', () => {
  const text = 'This meal was again again over. She were able.';
  const book = bookWith(text, 'en'); const scene = book.chapters[0]!.scenes[0]!;
  const mutations = [
    { id: 'm1', type: 'redundancy' as const, chapter: 'one', scene: scene.id, span: { start: 10, end: 25 }, original: 'was', mutated: 'was again again' },
    { id: 'm2', type: 'agreement' as const, chapter: 'one', scene: scene.id, span: { start: 36, end: 40 }, original: 'was', mutated: 'were' }
  ];
  const proposal = (target: string, replacement: string) => makeProposal({ chapter: 'one', scene: scene.id, category: 'grammar', target, replacement, sceneText: scene.text });
  const score = scoreProposals(book, [proposal('again again', 'again'), proposal('She were', 'She was')], mutations, 'none', []);
  assert.deepEqual(score.matched.map((item) => item.mutation_id), ['m1', 'm2']);
  assert.deepEqual(score.restored.map((item) => item.mutation_id), ['m2']);
});
