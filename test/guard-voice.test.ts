import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configSchema } from '../src/config.ts';
import { loadPack } from '../src/lang/pack.ts';
import { splitScenes } from '../src/book.ts';
import { makeProposal } from '../src/proposal/identity.ts';
import { voiceGuard } from '../src/guard/voice.ts';

test('fragment preservation rejects a join only when configured', async () => {
  const pack = (await loadPack('en')).pack;
  const text = 'Yeah. Ain’t happening.\n\nThe room was silent.\n';
  const book = { lang: 'en', chapters: [{ slug: 'one', title: 'One', file: 'one.md', text, scenes: splitScenes(text) }] };
  const proposal = makeProposal({ chapter: 'one', scene: 's0', category: 'sentence-structure', target: 'Yeah. Ain’t happening.', replacement: 'Yeah, that is not happening.', sceneText: text });
  assert.equal(voiceGuard(proposal, text, book, pack, configSchema.parse({ preserve: ['sentence-fragments'] })), 'sentence-fragment-preserved');
  assert.equal(voiceGuard(proposal, text, book, pack, configSchema.parse({})), null);
});
