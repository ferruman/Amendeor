import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { locate } from '../src/proposal/locate.ts';
import { makeProposal } from '../src/proposal/identity.ts';
import { acceptProposals, rejectProposals, readAccepted } from '../src/edited/decisions.ts';
import { capitalization } from '../src/rules/capitalization.ts';
import { doubledWord } from '../src/rules/doubled-word.ts';
import { semanticTrap } from '../src/guard/traps.ts';
import { loadPack } from '../src/lang/pack.ts';

test('D28: changed tokens cannot be rebased into substring targets', () => {
  for (const text of ['Corpora1 Doak', 'Corporal Doak']) assert.deepEqual(locate(text, { text: 'Corpora', replacement: 'Corporal' }), { stale: true });
  assert.ok('ok' in locate('Corpora Doak', { text: 'Corpora' }));
});

test('D29: reject withdraws an accepted edit append-only; reaccept works', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'amendeor-withdraw-'));
  const p = makeProposal({ category: 'spelling', chapter: 'one', scene: 'scene', target: 'Corpora', replacement: 'Corporal' });
  await acceptProposals(dir, [p], { acceptedBy: 'human:cli' });
  await rejectProposals(join(dir, 'state'), [p], 'human:cli', dir);
  assert.deepEqual(await readAccepted(dir), []);
  const lines = (await readFile(join(dir, 'accepted.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(lines.length, 2); assert.equal(lines[1].event, 'withdraw');
  await acceptProposals(dir, [p], { acceptedBy: 'human:cli' });
  assert.equal((await readAccepted(dir)).length, 1);
});

test('D25–27: abbreviations, proper plurals, idioms and chow chow stay intact', async () => {
  const { pack } = await loadPack('en', '');
  const ctx = { pack, config: { preserve: [] } } as any;
  for (const text of ['rt. hand', '1:30 a.m. call', 'p.m. to', 'misc. metal', 'Wed. argument', 'coop. w/']) assert.deepEqual(capitalization.detect({ text } as any, ctx), []);
  assert.equal(capitalization.detect({ text: 'Done. next.' } as any, ctx).length, 1);
  assert.deepEqual(doubledWord.detect({ text: 'She ate chow chow.' } as any, ctx), []);
  assert.equal(doubledWord.detect({ text: 'She ate the the relish.' } as any, ctx).length, 1);
  for (const [a,b] of [['Fridays','Friday'],['the Brandts','Brandt'],['a Hail Mary','a Hail Mark'],['Records Center','RECORD Center']]) assert.equal(semanticTrap(a!, b!, pack, { category: 'terminology', modelGenerated: true }), 'proper-name-change');
});

test('D25/double stop: "May.." becomes "May." without touching an ellipsis; "cig. butt" and "no corr. after" are not sentence starts', async () => {
  const { dashesEllipsis } = await import('../src/rules/dashes-ellipsis.ts');
  const { capitalization } = await import('../src/rules/capitalization.ts');
  const rules = [dashesEllipsis, capitalization];
  const { loadPack } = await import('../src/lang/pack.ts');
  const { pack } = await loadPack('en');
  const detect = (text: string) => rules.flatMap((r) => (r.langs.includes('en') ? r.detect({ id: 's', text } as never, { pack, config: { normalize: {}, preserve: [] }, dialogue: [], names: new Map(), wordCounts: new Map(), book: {} } as never) : []));
  const stop = detect('He was arrested on the fourteenth of May.. He is in custody. Wait... no.');
  assert.deepEqual(stop.filter((d) => d.reason.startsWith('Two full stops')).map((d) => [d.target, d.replacement]), [['May..', 'May.']]);
  const caps = detect('*Item 11 — cig. butt, embankment.* *M. — no corr. after 10:30.*').filter((d) => d.reason.startsWith('Capitalize'));
  assert.deepEqual(caps, []);
});
