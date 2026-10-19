import { readFileSync } from 'node:fs';

// Британский и американский английский (codicora/vectors/en-regional.json; копия рядом, contracts.test.mjs сверяет
// её с эталоном). Тег en-US проверяется на британские формы, en-GB — на американские; голый en региона не называет.
interface Term { kind: 'word' | 'spelling'; gb: string[]; us: string[]; shared?: Array<'gb' | 'us'>; polysemous?: Array<'gb' | 'us'> }
export interface RegionalHit { form: string; other: string; kind: Term['kind']; loose: boolean; polysemous: boolean; index: number }

const { terms } = JSON.parse(readFileSync(new URL('./regional.json', import.meta.url), 'utf8')) as { terms: Term[] };
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "['’]").replace(/ /g, '\\s+');
const key = (s: string) => s.toLowerCase().replace(/’/g, "'").replace(/\s+/g, ' ');
const cache = new Map<string, { forms: Map<string, Omit<RegionalHit, 'form' | 'index'>>; re: RegExp }>();

function matcher(side: 'gb' | 'us') {
  const hit = cache.get(side);
  if (hit) return hit;
  const other = side === 'gb' ? 'us' : 'gb';
  const forms = new Map<string, Omit<RegionalHit, 'form' | 'index'>>();
  for (const t of terms) t[side].forEach((form, i) => forms.set(key(form), { other: t[other][i] ?? t[other][0]!, kind: t.kind, loose: [...(t.shared ?? []), ...(t.polysemous ?? [])].includes(side), polysemous: (t.polysemous ?? []).includes(side) }));
  const alternation = [...forms.keys()].sort((a, b) => b.length - a.length).map(escape).join('|');
  const m = { forms, re: new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternation})(?![\\p{L}\\p{N}])`, 'giu') };
  cache.set(side, m);
  return m;
}

/** Регион тега: 'us' | 'gb' | null. */
export const regionOf = (language: string) => (/^en-(us|gb)$/i.exec(language)?.[1]?.toLowerCase() as 'us' | 'gb' | undefined) ?? null;

export function regionalHits(text: string, language: string): RegionalHit[] {
  const region = regionOf(language);
  if (!region || !text) return [];
  const { forms, re } = matcher(region === 'us' ? 'gb' : 'us');
  return [...text.matchAll(re)].map((m) => ({ form: m[0], ...forms.get(key(m[0]))!, index: m.index! }));
}
