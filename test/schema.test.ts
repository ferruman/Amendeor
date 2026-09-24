import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { proposalSchema } from '../src/proposal/schema.ts';

test('checked-in proposal JSON Schema matches the Zod contract', async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const actual = JSON.parse(await readFile(path.join(root, 'docs/schema/proposal.json'), 'utf8')) as Record<string, unknown>;
  const expected = z.toJSONSchema(proposalSchema, { target: 'draft-2020-12' }) as Record<string, unknown>;
  expected.$id = 'amendeor.proposal/0.1';
  assert.deepEqual(actual, expected);
});
