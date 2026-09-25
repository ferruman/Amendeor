import { sha256, normalizeText } from './hash.ts';

export interface Scene {
  id: string;
  text: string;
  implicit: boolean;
  contentHash: string;
  start: number;
  end: number;
  marker?: string;
}
export interface Chapter { slug: string; title: string; file: string; relativeFile?: string; scenes: Scene[]; text: string }
export interface Book { lang: string; chapters: Chapter[] }
export const TITLE_SCENE_ID = '@title';

export function splitScenes(text: string): Scene[] {
  const marker = /^<!--[ \t]*scene:[ \t]*([^\s]+)[ \t]*-->[ \t]*(?:\r?\n|$)/gm;
  const matches = [...text.matchAll(marker)];
  const scenes: Scene[] = [];
  if (!matches.length) return [makeScene('s0', text, true, 0, text.length)];
  const first = matches[0]!;
  if (first.index! > 0) scenes.push(makeScene('s0', text.slice(0, first.index), true, 0, first.index));
  for (let i = 0; i < matches.length; i++) {
    const current = matches[i]!;
    const start = current.index!;
    const bodyStart = start + current[0].length;
    const end = i + 1 < matches.length ? matches[i + 1]!.index! : text.length;
    scenes.push(makeScene(current[1]!, text.slice(bodyStart, end), false, bodyStart, end, current[0]));
  }
  return scenes;
}

function makeScene(id: string, text: string, implicit: boolean, start: number, end: number, marker?: string): Scene {
  return { id, text, implicit, contentHash: sha256(normalizeText(text)), start, end, ...(marker ? { marker } : {}) };
}
