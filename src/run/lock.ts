import { mkdir, open, readFile } from 'node:fs/promises';
import path from 'node:path';

export async function acquireLock(stateDir: string): Promise<() => Promise<void>> {
  await mkdir(stateDir, { recursive: true });
  const lockPath = path.join(stateDir, 'lock');
  let handle;
  try { handle = await open(lockPath, 'wx'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    let detail = 'lock exists';
    try {
      const lock = JSON.parse(await readFile(lockPath, 'utf8')) as { pid?: number };
      if (typeof lock.pid === 'number') {
        try { process.kill(lock.pid, 0); detail = `active process ${lock.pid}`; }
        catch { detail = `stale lock from process ${lock.pid}`; }
      }
    } catch { detail = 'unreadable lock'; }
    throw new Error(`Amendeor run refused: ${detail} at ${lockPath}. Remove the lock file manually if the process is no longer running.`);
  }
  await handle.writeFile(`${JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() })}\n`);
  await handle.close();
  return async () => { const { unlink } = await import('node:fs/promises'); await unlink(lockPath); };
}
