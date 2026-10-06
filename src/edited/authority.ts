// Делегированные полномочия (../../../DELEGATION.md): автор пишет authority/delegations.json; Amendeor только читает его
// и дописывает принятия под делегированием в authority/amendeor.jsonl — свой единственный файл вне edited/ и .codicora/.
import { appendFile, mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { canonicalJson, sha256 } from '../hash.ts';

const WEEK = 7 * 24 * 3600 * 1000;

export interface Delegation { id: string; workspace: string; granted_by: string; granted_at: string; expires_at: string; allow: string[]; deny?: string[]; limits?: { max_spend?: number; currency?: string }; revoked_at?: string | null }

// Отпечаток записи делегирования (DELEGATION.md §4): если запись потом правят задним числом, журнал это покажет.
export const delegationHash = (d: Delegation): string => sha256(canonicalJson({ ...d, revoked_at: undefined })); // отзыв — не правка

// Возвращает делегирование, если оно сейчас покрывает способность; иначе бросает ошибку с причиной для автора.
export async function requireDelegation(workspaceDir: string, id: string, capability: string, now = new Date()): Promise<{ delegation: Delegation; dir: string }> {
  const manifest = parse(await readFile(path.join(workspaceDir, 'codicora.yaml'), 'utf8')) as { project?: { id?: string }; authority?: { path?: string } } | null;
  const dir = path.resolve(workspaceDir, manifest?.authority?.path ?? 'authority');
  let doc: { schema?: string; delegations?: Delegation[] } | null = null;
  try { doc = JSON.parse(await readFile(path.join(dir, 'delegations.json'), 'utf8')); } catch { /* нет файла — нет делегирования */ }
  const refuse = (why: string): never => { throw new Error(`not-delegated: ${why}; the author must accept this directly`); };
  if (doc?.schema !== 'codicora.delegations/0.1') refuse('no readable authority/delegations.json — the author has delegated nothing');
  const d = (doc!.delegations ?? []).find((x) => x?.id === id) ?? refuse(`no delegation "${id}" in authority/delegations.json`);
  const granted = Date.parse(d.granted_at), expires = Date.parse(d.expires_at), t = now.getTime();
  const ws = manifest?.project?.id;
  const why = !d.workspace || !d.granted_by || !Array.isArray(d.allow) || Number.isNaN(granted) || Number.isNaN(expires) ? 'is missing workspace, granted_by, granted_at, expires_at or allow'
    : d.workspace !== ws ? `belongs to workspace "${d.workspace}", not "${ws}"`
    : expires - granted > WEEK ? 'is longer than 7 days and is not valid'
    : t < granted ? `is not valid before ${d.granted_at}`
    : t >= expires ? `expired at ${d.expires_at}`
    : d.revoked_at && Date.parse(d.revoked_at) <= t ? `was revoked at ${d.revoked_at}`
    : d.deny?.includes(capability) ? `denies ${capability}`
    : !d.allow.includes(capability) ? `does not allow ${capability}`
    : null;
  if (why) refuse(`delegation "${id}" ${why}`);
  return { delegation: d, dir };
}

// Сколько уже потрачено под делегированием всеми инструментами вместе, в его валюте (DELEGATION.md §4).
export async function spentUnder(dir: string, id: string, currency: string): Promise<number> {
  let total = 0;
  for (const name of (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith('.jsonl'))) {
    for (const line of (await readFile(path.join(dir, name), 'utf8')).split('\n')) {
      try { const r = JSON.parse(line) as { delegation_id?: string; currency?: string; cost?: unknown }; if (r.delegation_id === id && r.currency === currency && typeof r.cost === 'number') total += r.cost; } catch { /* пустая или чужая строка */ }
    }
  }
  return total;
}

export async function journal(dir: string, record: Record<string, unknown>): Promise<void> {
  await mkdir(dir, { recursive: true });
  await appendFile(path.join(dir, 'amendeor.jsonl'), `${JSON.stringify({ schema: 'codicora.action/0.1', at: new Date().toISOString(), tool: 'amendeor', authority: 'delegated', ...record })}\n`);
}
