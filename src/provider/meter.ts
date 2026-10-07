// Счётчик трат под делегированием (DELEGATION.md §4): до каждого вызова модели — худший случай (вход по два символа
// на токен, весь бюджет выхода, по цене из amendeor.yaml) резервируется в authority/ под общим замком; после —
// фактическая цена закрывает резервацию. Без цены или в другой валюте делегирование платный вызов не покрывает.
// Один счётчик на команду; Gateway читает его из AsyncLocalStorage. Каждая повторная попытка резервирует заново.
import { AsyncLocalStorage } from 'node:async_hooks';
import { reserveSpend, settleSpend, type SpendContext } from '../edited/authority.ts';

export interface Meter { spent: number; refused?: string; blocked?: number; ctx?: SpendContext }
export const meter = new AsyncLocalStorage<Meter>();

export class SpendRefused extends Error {}

type Price = { input_per_m: number; output_per_m: number; currency: string } | undefined;
export interface Reservation { id: string; dir: string; currency: string }

export async function reserve(m: Meter, price: Price, inputChars: number, maxTokens: number): Promise<Reservation> {
  if (m.refused) { m.blocked = (m.blocked ?? 0) + 1; throw new SpendRefused(m.refused); }
  const stop = (why: string): never => { m.refused = why; throw new SpendRefused(why); };
  if (!price) stop('the provider has no price in amendeor.yaml, so the cost of a call cannot be bounded under a delegation; the author must run this directly');
  if (!m.ctx) stop('no delegation to reserve against');
  const worst = (Math.ceil(inputChars / 2) * price!.input_per_m + maxTokens * price!.output_per_m) / 1_000_000;
  try { return { ...(await reserveSpend(m.ctx!, worst, price!.currency)), currency: price!.currency }; }
  catch (error) { return stop((error as Error).message.replace(/^not-delegated: /, '')); }
}

export async function settle(m: Meter, reservation: Reservation, cost: number): Promise<void> {
  m.spent += cost;
  await settleSpend(reservation, m.ctx!.id, cost, reservation.currency);
}
