import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitScenes } from '../src/book.ts';
import { makeProposal } from '../src/proposal/identity.ts';
import { scoreProposals } from '../eval/score.ts';

test('mutation recall requires an overlapping change with untouched outside text', () => {
  const sceneText = 'The teh door stood open.';
  const book = { lang: 'en', chapters: [
    { slug: 'a', title: 'A', file: 'a.md', text: sceneText, scenes: splitScenes(sceneText) },
    { slug: 'control', title: 'Control', file: 'control.md', text: 'Clean prose.', scenes: splitScenes('Clean prose.') }
  ] };
  const good = makeProposal({ chapter: 'a', scene: 's0', category: 'spelling', target: 'teh', replacement: 'the', sceneText });
  const badOutside = makeProposal({ chapter: 'a', scene: 's0', category: 'spelling', target: 'The teh', replacement: 'A the', sceneText });
  const control = makeProposal({ chapter: 'control', scene: 's0', category: 'clarity', target: 'Clean', replacement: 'Clear', sceneText: 'Clean prose.' });
  const mutation = [{ id: 'm1', type: 'typo' as const, chapter: 'a', scene: 's0', span: { start: 4, end: 7 }, original: 'the', mutated: 'teh' }];
  const result = scoreProposals(book, [good, badOutside, control], mutation, 'control', []);
  assert.deepEqual(result.matched, [{ mutation_id: 'm1', proposal_id: good.id }]);
  assert.equal(result.recall.typo?.rate, 1);
  assert.equal(result.unnecessary.control_proposals, 1);
  assert.equal(result.unnecessary.count, 2);
});

test('human labels yield precision for each cited formulaic pattern', () => {
  const text = 'At the end of the day, the door stayed shut.';
  const book = { lang: 'en', chapters: [{ slug: 'a', title: 'A', file: 'a.md', text, scenes: splitScenes(text) }] };
  const proposal = makeProposal({ chapter: 'a', scene: 's0', category: 'prose-pattern', target: 'At the end of the day, the', replacement: 'The', source_findings: ['formulaic.filler-frame'], sceneText: text });
  const score = scoreProposals(book, [proposal], [], 'none', [], new Map([[proposal.id, true]]));
  assert.equal(score.precision, 1);
  assert.equal(score.precision_by_pattern['formulaic.filler-frame'], 1);
});
