import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { canonicalJson, sha256 } from './hash.ts';

export function cacheKey(inputs: unknown): string { return sha256(canonicalJson(inputs)).slice(7); }

export class Cache {
  readonly stateDir: string;
  readonly disabled: boolean;
  constructor(stateDir: string, disabled = false) { this.stateDir = stateDir; this.disabled = disabled; }

  private file(stage: string, key: string): string {
    if (!/^[a-z0-9-]+$/.test(stage) || !/^[0-9a-f]{64}$/.test(key)) throw new Error('invalid cache stage or key');
    return path.join(this.stateDir, 'cache', stage, `${key}.json`);
  }

  async read<T>(stage: string, inputs: unknown): Promise<T | undefined> {
    if (this.disabled) return undefined;
    try { return JSON.parse(await readFile(this.file(stage, cacheKey(inputs)), 'utf8')) as T; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  }

  async write<T>(stage: string, inputs: unknown, value: T): Promise<void> {
    if (this.disabled) return;
    const file = this.file(stage, cacheKey(inputs));
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(value)}\n`, { flag: 'wx' });
      await rename(temporary, file);
    } finally { await rm(temporary, { force: true }); }
  }
}
