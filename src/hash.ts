import { createHash } from 'node:crypto';

export function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function canonicalJson(value: unknown): string {
  const visit = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(visit);
    if (item && typeof item === 'object') {
      return Object.fromEntries(Object.keys(item).sort().flatMap((key) => {
        const val = (item as Record<string, unknown>)[key];
        return val === undefined ? [] : [[key, visit(val)]];
      }));
    }
    return item;
  };
  return JSON.stringify(visit(value));
}

export function normalizeText(text: string): string {
  const normalized = text.replace(/^\uFEFF/, '').normalize('NFC').replace(/\r\n?/g, '\n')
    .split('\n').map((line) => line.replace(/[ \t\u00A0]+$/g, '')).join('\n')
    .replace(/\n{3,}/g, '\n\n').replace(/\n*$/, '\n');
  return normalized;
}

export function normalizeQuote(text: string): string {
  return text.normalize('NFC').replace(/\s+/gu, ' ').trim();
}
