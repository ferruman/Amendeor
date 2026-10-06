// DELEGATION.md §7 как данные (../vectors/delegation/): прочтение контракта Amendeor должно давать то же решение
// в каждом случае, с тратами. Пропускается, если спецификация Codicora не лежит рядом с репозиторием.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { delegationHash, requireDelegation, spentUnder, type Delegation } from '../src/edited/authority.ts';

const vector = fileURLToPath(new URL('../../vectors/delegation/', import.meta.url));
const kinds: Array<[RegExp, string]> = [
  [/denies/, 'refused:denied'], [/does not allow/, 'refused:not-allowed'], [/expired/, 'refused:expired'], [/not valid before/, 'refused:not-yet-valid'],
  [/belongs to workspace/, 'refused:other-workspace'], [/was revoked at/, 'refused:revoked'], [/longer than 7 days/, 'refused:longer-than-7-days'], [/no delegation/, 'refused:unknown'],
];
const kind = (reason: string) => kinds.find(([re]) => re.test(reason))?.[1] ?? `unclassified: ${reason}`;

test('вектор делегирования: каждое решение и отпечаток каждой записи — как в DELEGATION.md §7', { skip: !existsSync(path.join(vector, 'cases.json')) }, async () => {
  const { cases, delegation_hash: { expected } } = JSON.parse(await readFile(path.join(vector, 'cases.json'), 'utf8')) as {
    cases: Array<{ now: string; workspace?: string; delegation: string; capability: string; estimate?: number; currency?: string; expect: string }>;
    delegation_hash: { expected: Record<string, string> };
  };
  for (const c of cases) {
    let ws = vector;
    if (c.workspace) {
      ws = await mkdtemp(path.join(os.tmpdir(), 'deleg-vector-'));
      await cp(vector, ws, { recursive: true });
      await writeFile(path.join(ws, 'codicora.yaml'), `spec: codicora/v1\nproject:\n  id: ${c.workspace}\n`);
    }
    let got: string;
    try {
      const { delegation, dir } = await requireDelegation(ws, c.delegation, c.capability, new Date(c.now));
      got = 'delegated';
      if (c.estimate !== undefined) {
        const { max_spend: max = 0, currency } = delegation.limits ?? {};
        got = !currency || c.currency !== currency ? 'refused:currency'
          : c.estimate <= max - await spentUnder(dir, c.delegation, currency) ? 'delegated' : 'refused:budget';
      }
    } catch (e) { got = kind((e as Error).message); }
    assert.equal(got, c.expect, JSON.stringify(c));
  }
  const { delegations } = JSON.parse(await readFile(path.join(vector, 'authority/delegations.json'), 'utf8')) as { delegations: Delegation[] };
  for (const d of delegations) assert.equal(delegationHash(d), expected[d.id], d.id);
});
