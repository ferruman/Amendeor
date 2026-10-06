// Счётчик трат под делегированием (DELEGATION.md §4): до каждого вызова модели — худший случай (вход по два символа
// на токен, весь бюджет выхода, по цене из amendeor.yaml) должен уместиться в остаток. Без цены или в другой валюте
// делегирование платный вызов не покрывает. Один счётчик на команду; Gateway читает его из AsyncLocalStorage.
import { AsyncLocalStorage } from 'node:async_hooks';

export interface Meter { remaining: number; currency: string; spent: number; refused?: string }
export const meter = new AsyncLocalStorage<Meter>();

export class SpendRefused extends Error {}

type Price = { input_per_m: number; output_per_m: number; currency: string } | undefined;

export function reserve(m: Meter, price: Price, inputChars: number, maxTokens: number): number {
  if (m.refused) throw new SpendRefused(m.refused);
  const stop = (why: string): never => { m.refused = why; throw new SpendRefused(why); };
  if (!price) stop('the provider has no price in amendeor.yaml, so the cost of a call cannot be bounded under a delegation; the author must run this directly');
  if (price!.currency !== m.currency) stop(`the provider prices in ${price!.currency} and the delegation limits spending in ${m.currency}; no conversion is applied`);
  const worst = (Math.ceil(inputChars / 2) * price!.input_per_m + maxTokens * price!.output_per_m) / 1_000_000;
  if (m.spent + worst > m.remaining) stop(`over the delegated budget: ${(m.spent + worst).toFixed(4)} ${m.currency} worst case against ${m.remaining.toFixed(4)} left — ask the author for more (a new delegation) or to run this directly`);
  return worst;
}
