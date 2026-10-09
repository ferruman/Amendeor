// Делегированные полномочия (../../../DELEGATION.md): автор пишет authority/delegations.json; Amendeor только читает его
// и дописывает принятия под делегированием в authority/amendeor.jsonl — свой единственный файл вне edited/ и .codicora/.
import { appendFile, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { parse } from 'yaml';
import { canonicalJson, sha256 } from '../hash.ts';
import { acceptProposals, type Acceptance } from './decisions.ts';
import type { Proposal } from '../proposal/schema.ts';

const WEEK = 7 * 24 * 3600 * 1000;

// Кто у терминала (DELEGATION.md §1, §6): в известной среде агента (CODICORA_AGENT, CLAUDECODE, песочница Codex) —
// агент cli:<имя>, а не человек. Честная запись и защита от случайного превышения, а не проверка личности.
export function cliActor(env: NodeJS.ProcessEnv = process.env, delegated = false): string {
  const agent = env.CODICORA_AGENT?.trim() || (env.CLAUDECODE ? 'claude-code' : env.CODEX_SANDBOX || env.CODEX_SANDBOX_NETWORK_DISABLED ? 'codex' : '');
  return agent ? `cli:${agent}` : delegated ? 'cli:agent' : 'human:cli';
}

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

// Сколько потрачено под делегированием всеми инструментами вместе, в его валюте (DELEGATION.md §4): закрытая резервация —
// по фактической цене, открытая — целиком (вызов мог быть оплачен, а цену никто не записал), и cost строк действий,
// написанных до резерваций.
export async function spentUnder(dir: string, id: string, currency: string): Promise<number> {
  const lines: Array<Record<string, unknown>> = [];
  for (const name of (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith('.jsonl'))) {
    for (const [n, line] of (await readFile(path.join(dir, name), 'utf8')).split('\n').entries()) {
      if (!line.trim()) continue;
      let r: unknown;
      try { r = JSON.parse(line); } catch { r = null; }
      // Оборванная или испорченная запись может быть резервацией: считать в обход неё — недосчитать удержанное,
      // поэтому новых трат нет, пока журнал не починят (строка остаётся как улика).
      if (!r || typeof r !== 'object') throw new Error(`authority/${name} line ${n + 1} is not a JSON record (torn or corrupt); no paid call is authorized until it is repaired`);
      lines.push(r as Record<string, unknown>);
    }
  }
  const settled = new Map(lines.filter((r) => r.event === 'settle' && typeof r.cost === 'number').map((r) => [r.reservation_id, r.cost as number]));
  let total = 0;
  for (const r of lines) {
    if (r.delegation_id !== id || r.currency !== currency) continue;
    if (r.event === 'reserve' && typeof r.amount === 'number') total += settled.get(r.reservation_id) ?? r.amount;
    else if (r.event === undefined && typeof r.cost === 'number') total += r.cost;
  }
  return total;
}

// authority/.budget.lock держится только пока резервация проверяется и пишется — никогда во время вызова модели.
// ponytail: замок старше 30 с — упавший владелец, его снимают; два ожидающих, снявших один и тот же старый замок
// одновременно, могут пройти оба. Нужны падение и гонка разом.
async function withBudgetLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  await mkdir(dir, { recursive: true });
  const lock = path.join(dir, '.budget.lock');
  for (const started = Date.now(); ;) {
    try { await mkdir(lock); break; } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const age = Date.now() - await stat(lock).then((s) => s.mtimeMs, () => Date.now());
      if (age > 30_000) { await rm(lock, { recursive: true, force: true }); continue; }
      if (Date.now() - started > 10_000) throw new Error('the budget lock authority/.budget.lock stayed held for 10 s; try again');
      await new Promise((resolve) => setTimeout(resolve, 5 + Math.random() * 20));
    }
  }
  try { return await fn(); } finally { await rm(lock, { recursive: true, force: true }); }
}

export interface SpendContext { workspaceDir: string; id: string; capability: string; actor: string; subject: string; delegation_hash?: string }

// Перед платным вызовом, под замком: перечитать делегирование (отзыв, истечение или правка с начала команды
// останавливают этот вызов), сложить потраченное и удержанное всеми инструментами, записать резервацию.
export async function reserveSpend(ctx: SpendContext, amount: number, currency: string): Promise<{ id: string; dir: string }> {
  const { dir } = await requireDelegation(ctx.workspaceDir, ctx.id, ctx.capability);
  return withBudgetLock(dir, async () => {
    const { delegation: d } = await requireDelegation(ctx.workspaceDir, ctx.id, ctx.capability);
    const hash = delegationHash(d);
    ctx.delegation_hash ??= hash;
    if (ctx.delegation_hash !== hash) throw new Error(`delegation "${ctx.id}" was edited after this operation was authorized; stop and ask the author`);
    const limits = d.limits;
    if (typeof limits?.max_spend !== 'number') throw new Error('the delegation sets no spending limit (limits.max_spend), so it covers no model call');
    if (limits.currency !== currency) throw new Error(`the provider prices in ${currency} and the delegation limits spending in ${limits.currency}; no conversion is applied`);
    const spent = await spentUnder(dir, ctx.id, currency);
    if (spent + amount > limits.max_spend) throw new Error(`over the delegated budget: ${spent.toFixed(4)} spent or held + ${amount.toFixed(4)} ${currency} worst case > ${limits.max_spend} — ask the author for more (a new delegation) or to run this directly`);
    const id = `amendeor:${randomUUID()}`;
    await journal(dir, { event: 'reserve', reservation_id: id, capability: ctx.capability, performed_by: ctx.actor, authorized_by: d.granted_by, delegation_id: ctx.id, delegation_hash: delegationHash(d), subject: ctx.subject, amount, currency });
    return { id, dir };
  });
}

// После вызова фактическая цена заменяет резервацию. Вызов с неизвестным исходом не закрывается — его сумма остаётся потраченной.
export async function settleSpend(reservation: { id: string; dir: string }, delegationId: string, cost: number, currency: string): Promise<void> {
  await journal(reservation.dir, { event: 'settle', reservation_id: reservation.id, delegation_id: delegationId, cost, currency });
}

export async function journal(dir: string, record: Record<string, unknown>): Promise<void> {
  await mkdir(dir, { recursive: true });
  await appendFile(path.join(dir, 'amendeor.jsonl'), `${JSON.stringify({ schema: 'codicora.action/0.1', at: new Date().toISOString(), tool: 'amendeor', authority: 'delegated', ...record })}\n`);
}

// Единственный путь принятия правок (DELEGATION.md §5): явный accept и auto_accept: mechanical проходят одну проверку.
// Человек (human:cli, human:ui) принимает сам; агент — только под делегированием, покрывающим amendeor.accept.
// Настройка auto_accept не заменяет полномочий: без них предложения остаются ожидающими.
export interface AcceptAuthority { acceptedBy: string; grant?: { delegation: Delegation; dir: string } }
export async function authorizeAcceptance(workspaceDir: string | undefined, actor: string, delegation?: string): Promise<AcceptAuthority> {
  if (!delegation && actor.startsWith('human:')) return { acceptedBy: actor };
  if (!delegation) throw new Error(`not-delegated: this terminal is an agent's (${actor}); accepting copy edits is the author's decision — they run amendeor accept themselves, or grant a delegation that allows amendeor.accept and you pass --delegation <id>`);
  if (!workspaceDir) throw new Error('not-delegated: a delegation lives in a Codicora workspace; this target has none');
  return { acceptedBy: actor, grant: await requireDelegation(workspaceDir, delegation, 'amendeor.accept') };
}

export async function acceptAuthorized(editedDir: string, proposals: Proposal[], auth: AcceptAuthority, allowUnverified = false): Promise<Acceptance[]> {
  const g = auth.grant?.delegation;
  const accepted = await acceptProposals(editedDir, proposals, { allowUnverified, acceptedBy: auth.acceptedBy, ...(g ? { provenance: { authority: 'delegated' as const, authorized_by: g.granted_by, delegation_id: g.id } } : {}) });
  if (auth.grant && proposals.length) await journal(auth.grant.dir, { capability: 'amendeor.accept', performed_by: auth.acceptedBy, authorized_by: g!.granted_by, delegation_id: g!.id, delegation_hash: delegationHash(g!), subject: `proposals ${proposals.map((proposal) => proposal.id).join(', ')}` });
  return accepted;
}
