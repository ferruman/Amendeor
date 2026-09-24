import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { proposalSchema, type Proposal } from '../proposal/schema.ts';

export function newRunId(date = new Date()): string {
  const stamp = date.toISOString().replace(/:/g, '-').replace(/\.\d{3}Z$/, 'Z');
  return `${stamp}-${randomBytes(2).toString('hex')}`;
}

export async function writeRun(stateDir: string, id: string, files: Record<string, string>, replace = false): Promise<void> {
  if (!/^[0-9A-Za-z._-]+$/.test(id) || id.startsWith('.')) throw new Error('invalid run id');
  const runs = path.join(stateDir, 'runs'); const finalDir = path.join(runs, id); const tmpDir = path.join(runs, `.tmp-${id}`);
  const backupDir = path.join(runs, `.backup-${id}`);
  await mkdir(runs, { recursive: true });
  await rm(tmpDir, { recursive: true, force: true });
  try {
    await mkdir(tmpDir, { recursive: false });
    for (const [name, content] of Object.entries(files)) {
      const destination = path.resolve(tmpDir, name);
      if (!destination.startsWith(`${tmpDir}${path.sep}`)) throw new Error(`invalid run file path: ${name}`);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, content, 'utf8');
    }
    if (replace) {
      await rm(backupDir, { recursive: true, force: true });
      try { await rename(finalDir, backupDir); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    try { await rename(tmpDir, finalDir); }
    catch (error) { if (replace) { try { await rename(backupDir, finalDir); } catch {} } throw error; }
    if (replace) await rm(backupDir, { recursive: true, force: true });
    const latestTmp = path.join(stateDir, `.latest-${randomBytes(4).toString('hex')}.tmp`);
    await writeFile(latestTmp, `${JSON.stringify({ run_id: id }, null, 2)}\n`, 'utf8');
    await rename(latestTmp, path.join(stateDir, 'latest.json'));
  } catch (error) { await rm(tmpDir, { recursive: true, force: true }); throw error; }
}

export async function readRun(stateDir: string, id: string | 'latest'): Promise<{ runDir: string; proposals: Proposal[]; run: unknown }> {
  const runId = id === 'latest' ? (JSON.parse(await readFile(path.join(stateDir, 'latest.json'), 'utf8')) as { run_id: string }).run_id : id;
  const runDir = path.join(stateDir, 'runs', runId);
  const proposalsText = await readFile(path.join(runDir, 'proposals.jsonl'), 'utf8');
  const proposals: Proposal[] = [];
  const ids = new Set<string>();
  for (const [index, line] of proposalsText.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      const proposal = proposalSchema.parse(JSON.parse(line));
      if (ids.has(proposal.id)) throw new Error(`duplicate-proposal-id: ${proposal.id}`);
      ids.add(proposal.id); proposals.push(proposal);
    }
    catch (error) { throw new Error(`invalid proposal in ${runId}/proposals.jsonl line ${index + 1}: ${(error as Error).message}`); }
  }
  let run: unknown = {};
  try { run = JSON.parse(await readFile(path.join(runDir, 'run.json'), 'utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return { runDir, proposals, run };
}
