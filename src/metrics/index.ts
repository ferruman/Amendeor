import type { Book, Scene } from '../book.ts';
import type { LanguagePack } from '../lang/pack.ts';
import { dialogueSpans } from '../text/dialogue.ts';
import { properNouns } from '../text/names.ts';
import { paragraphs, sentences, words } from '../text/segment.ts';

export interface Hotspot { chapter: string; scene: string; metric: string; value: number; baseline: number; floor: number }
export interface SceneMetrics { chapter: string; scene: string; words: number; values: Record<string, number> }
export interface MetricsReport { scenes: SceneMetrics[]; baseline: Record<string, number>; hotspots: Hotspot[] }

const floors: Record<string, number> = {
  'ngram-repeats': 2, 'word-frequency-spike': 40, 'doubled-phrases': 1, 'dialogue-tags': 8,
  'sentence-length': 24, 'opening-repetition': 2, 'ending-repetition': 2,
  'not-but': 2, tricolons: 2, 'rhetorical-questions': 2, 'filter-verbs': 12, adverbs: 20,
  'dash-density': 12, 'semicolon-density': 4
};

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function percentile(values: number[], fraction: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * fraction)]!;
}

function count(pattern: RegExp, text: string): number { return [...text.matchAll(pattern)].length; }

function ngramRepeats(tokens: string[], stopwords: Set<string>): number {
  const counts = new Map<string, number>();
  for (let index = 0; index + 2 < tokens.length; index++) {
    const gram = tokens.slice(index, index + 3);
    if (gram.filter((word) => !stopwords.has(word)).length < 2) continue;
    const key = gram.join(' '); counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.values()].reduce((sum, value) => sum + Math.max(0, value - 1), 0);
}

function metricsForScene(scene: Scene, chapter: string, pack: LanguagePack, stopwords: Set<string>, names: Set<string>, openingCount: Map<string, number>, endingCount: Map<string, number>): SceneMetrics {
  const tokens = words(scene.text); const lower = tokens.map((token) => token.lower); const total = Math.max(1, lower.length);
  const perThousand = (value: number) => value * 1000 / total;
  const contentCounts = new Map<string, number>();
  for (const token of lower) if (!stopwords.has(token) && !names.has(token) && token.length > 3) contentCounts.set(token, (contentCounts.get(token) ?? 0) + 1);
  let topContentCount = 0;
  for (const value of contentCounts.values()) topContentCount = Math.max(topContentCount, value);
  const sentencesInScene = sentences(scene.text, pack);
  const sentenceLengths = sentencesInScene.map((sentence) => words(sentence.text).length);
  const openings = lower.slice(0, 3).join(' '); const endings = lower.slice(-3).join(' ');
  const dialogue = dialogueSpans(scene.text, pack);
  const values: Record<string, number> = {
    'ngram-repeats': ngramRepeats(lower, stopwords),
    'word-frequency-spike': perThousand(topContentCount),
    'doubled-phrases': paragraphs(scene.text).reduce((sum, paragraph) => sum + ngramRepeats(words(paragraph.text).map((token) => token.lower), stopwords), 0),
    'dialogue-tags': perThousand(dialogue.length && count(/\b(?:said|asked|replied|сказал|сказала|спросил|ответил)\b/giu, scene.text)),
    'sentence-length': sentenceLengths.length ? sentenceLengths.reduce((sum, value) => sum + value, 0) / sentenceLengths.length : 0,
    'opening-repetition': openings ? openingCount.get(openings) ?? 0 : 0,
    'ending-repetition': endings ? endingCount.get(endings) ?? 0 : 0,
    'not-but': count(/\bnot\b[^.!?\n]{1,80}\bbut\b|\bне\b[^.!?\n]{1,80}\bно\b/giu, scene.text),
    tricolons: sentencesInScene.filter((sentence) => (sentence.text.match(/,/g) ?? []).length >= 2 && /\b(?:and|и)\b/iu.test(sentence.text)).length,
    'rhetorical-questions': count(/\?\s*(?:\n|$)/g, scene.text),
    'filter-verbs': perThousand(lower.filter((token) => pack.filter_verbs.includes(token)).length),
    'dash-density': perThousand(count(/—/g, scene.text)),
    'semicolon-density': perThousand(count(/;/g, scene.text))
  };
  if (pack.adverb_suffixes.length) values.adverbs = perThousand(lower.filter((token) => pack.adverb_suffixes.some((suffix) => token.endsWith(suffix))).length);
  return { chapter, scene: scene.id, words: lower.length, values };
}

export function computeMetrics(book: Book, pack: LanguagePack): MetricsReport {
  const names = new Set([...properNouns(book, pack).keys()].map((name) => name.toLocaleLowerCase()));
  const stopwords = new Set(pack.stopwords.map((word) => word.toLocaleLowerCase()));
  const openings = new Map<string, number>(); const endings = new Map<string, number>();
  for (const chapter of book.chapters) for (const scene of chapter.scenes) {
    const tokens = words(scene.text).map((token) => token.lower);
    const opening = tokens.slice(0, 3).join(' '); const ending = tokens.slice(-3).join(' ');
    if (opening) openings.set(opening, (openings.get(opening) ?? 0) + 1);
    if (ending) endings.set(ending, (endings.get(ending) ?? 0) + 1);
  }
  const scenes = book.chapters.flatMap((chapter) => chapter.scenes.map((scene) => metricsForScene(scene, chapter.slug, pack, stopwords, names, openings, endings)));
  const baseline: Record<string, number> = {}; const hotspots: Hotspot[] = [];
  for (const metric of Object.keys(floors)) {
    if (metric === 'adverbs' && !pack.adverb_suffixes.length) continue;
    const values = scenes.map((scene) => scene.values[metric] ?? 0);
    const middle = median(values); baseline[metric] = middle;
    const spread = percentile(values, 0.75) - percentile(values, 0.25);
    const threshold = middle + Math.max(1.5 * spread, middle * 0.5, 0.001);
    for (const scene of scenes) {
      const value = scene.values[metric] ?? 0;
      if (value > threshold && value >= floors[metric]!) hotspots.push({ chapter: scene.chapter, scene: scene.scene, metric, value, baseline: middle, floor: floors[metric]! });
    }
  }
  return { scenes, baseline, hotspots };
}
