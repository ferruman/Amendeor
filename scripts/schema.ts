import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { proposalSchema } from '../src/proposal/schema.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schema = z.toJSONSchema(proposalSchema, { target: 'draft-2020-12' });
schema.$id = 'amendeor.proposal/0.1';
await mkdir(path.join(root, 'docs/schema'), { recursive: true });
await writeFile(path.join(root, 'docs/schema/proposal.json'), `${JSON.stringify(schema, null, 2)}\n`);
