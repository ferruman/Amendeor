import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { fileURLToPath } from 'node:url';

export const packSchema = z.object({
  version: z.string(), language: z.string(), stopwords: z.array(z.string()), negation: z.array(z.string()), modal: z.array(z.string()),
  quote_pairs: z.array(z.tuple([z.string(), z.string()])), abbreviations: z.array(z.string()), filter_verbs: z.array(z.string()),
  adverb_suffixes: z.array(z.string()), dash: z.object({ speech: z.string(), between_words: z.string() }),
  spelling_variants: z.array(z.tuple([z.string(), z.string()])), register: z.object({ formal: z.array(z.string()), informal: z.array(z.string()) }),
  chars_per_token: z.number().positive()
});
export type LanguagePack = z.infer<typeof packSchema>;
export interface LoadedPack { pack: LanguagePack; status: 'loaded' | 'derived'; warning?: string }

export function derivedStopwords(text: string): string[] {
  const counts = new Map<string, number>();
  for (const word of text.toLowerCase().match(/[\p{L}]{1,4}/gu) ?? []) counts.set(word, (counts.get(word) ?? 0) + 1);
  if (!counts.size) for (const word of text.toLowerCase().match(/[\p{L}]+/gu) ?? []) counts.set(word, (counts.get(word) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([word]) => word);
}

export async function loadPack(language: string, bookText = ''): Promise<LoadedPack> {
  const base = language.toLowerCase().split('-')[0]!;
  if (!/^[a-z]{2,3}$/.test(base)) throw new Error(`invalid language: ${language}`);
  const file = fileURLToPath(new URL(`./${base}/pack.json`, import.meta.url));
  try { return { pack: packSchema.parse(JSON.parse(await readFile(file, 'utf8'))), status: 'loaded' }; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const warning = `language pack missing for ${language}; using derived stopwords`;
    return { pack: packSchema.parse({ version: 'derived/1', language: base, stopwords: derivedStopwords(bookText), negation: [], modal: [], quote_pairs: [['“', '”']], abbreviations: [], filter_verbs: [], adverb_suffixes: [], dash: { speech: '—', between_words: '—' }, spelling_variants: [], register: { formal: [], informal: [] }, chars_per_token: 3 }), status: 'derived', warning };
  }
}
