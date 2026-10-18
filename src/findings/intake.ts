import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { findingSchema, type Finding } from './schema.ts';
import type { OpenedSource } from '../source/index.ts';
import type { FormulaicHit } from '../patterns/formulaic.ts';
import { canonicalJson, normalizeQuote, sha256 } from '../hash.ts';

export const isExternalFinding = (id: string): boolean => /^[a-z][a-z0-9-]*:[0-9a-f]{16}$/u.test(id);
export interface IntakeItem { id: string; classification: 'applicable' | 'not-applicable' | 'ambiguous' | 'already-resolved' | 'skipped'; reason: string; signals: number; evidence?: number }
// Ляп прохода по всей книге с исправленной цитатой: edit делает из него правку только на решение автора.
export interface SlipFix { id: string; chapter: string; scene: string; start: number; quote: string; replacement: string; reason: string }
export interface FindingsIntake { read: number; applicable: number; items: IntakeItem[]; signals: FormulaicHit[]; protected: FormulaicHit[]; warnings: string[]; slips: SlipFix[] }
const statusSchema = z.object({ schema: z.literal('codicora.status/0.1'), finding_id: z.string(), status: z.enum(['open', 'acknowledged', 'fixed', 'wontfix', 'false-positive']), by: z.string(), at: z.string().datetime(), evidence: z.string().optional() });
const runId = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}Z-[0-9a-f]{4}$/u;

// Имена путей берём только из проверенных slug/run_id, не из location.file или цитат.
export function validateFinding(value: unknown, tool: string, run: string): Finding {
  const finding = findingSchema.parse(value);
  const id = tool + ':' + sha256(canonicalJson(finding.fingerprint.primary)).slice(7, 23);
  if (finding.id !== id || finding.tool.name !== tool || finding.run_id !== run) throw new Error('finding identity or run mismatch');
  for (const quote of finding.evidence) if (quote.type === 'quote' && quote.hash !== sha256(normalizeQuote(quote.text))) throw new Error('quote hash mismatch');
  const anchors = finding.evidence.map((e) => e.type === 'quote' ? `quote:${e.scene}:${e.hash}` : e.type === 'metric' ? `metric:${e.name}:${e.value}` : `reference:${e.uri}`).sort();
  if (sha256(anchors.join('\n')) !== finding.fingerprint.evidence) throw new Error('evidence hash mismatch');
  return finding;
}

// Каждая запись цитаты обозначает одно вхождение; одинаковые цитаты в сцене распределяются по порядку.
// Не ищем исчезнувшую цитату по всей книге: перемещение/неоднозначность не даёт разрешения править другое место.
export function routeFinding(source: OpenedSource, finding: Finding): { signals: FormulaicHit[]; items: IntakeItem[] } {
  const signals: FormulaicHit[] = [], items: IntakeItem[] = [];
  const used = new Map<string, number>();
  for (const [index, evidence] of finding.evidence.entries()) {
    if (evidence.type !== 'quote') continue;
    const locations = source.book.chapters.flatMap((chapter) => chapter.scenes.filter((scene) => scene.id === evidence.scene).map((scene) => ({ chapter, scene })));
    const fail = (classification: IntakeItem['classification'], reason: string) => items.push({ id: finding.id, classification, reason, signals: 0, evidence: index });
    if (locations.length > 1) { fail('ambiguous', 'scene id is not unique'); continue; }
    if (!locations.length) { fail('already-resolved', 'evidence scene no longer present'); continue; }
    const { chapter, scene } = locations[0]!;
    const key = evidence.scene + ':' + evidence.text;
    const nth = used.get(key) ?? 0; used.set(key, nth + 1);
    const matches: number[] = [];
    for (let at = scene.text.indexOf(evidence.text); at >= 0; at = scene.text.indexOf(evidence.text, at + evidence.text.length)) matches.push(at);
    const start = matches[nth];
    if (start === undefined) { fail('already-resolved', 'evidence quote no longer present verbatim'); continue; }
    signals.push({ id: finding.id, language: source.book.lang, provenance: 'codicora.finding/0.1', chapter: chapter.slug, scene: scene.id, start, end: start + evidence.text.length, quote: evidence.text,
      reason: `${finding.evidence.filter((e) => e.type === 'quote').length} recorded occurrences in this book. Repetition may be an intended motif. Keep occurrences that carry the scene; count alone does not justify an edit.` });
    items.push({ id: finding.id, classification: 'applicable', reason: 'verbatim evidence located', signals: 1, evidence: index });
  }
  return { signals, items };
}

export async function readFindings(source: OpenedSource): Promise<FindingsIntake> {
  const result: FindingsIntake = { read: 0, applicable: 0, items: [], signals: [], protected: [], warnings: [], slips: [] };
  if (!source.findingsDir) return result;
  const entries = await readdir(source.findingsDir, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error; });
  const statuses = new Map<string, z.infer<typeof statusSchema>>();
  try {
    const overlay = await readFile(path.join(source.findingsDir, '_status.jsonl'), 'utf8');
    for (const line of overlay.split(/\r?\n/u).filter((line) => line.trim())) { const status = statusSchema.parse(JSON.parse(line)); statuses.set(status.finding_id, status); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { result.warnings.push('findings status overlay unreadable; intake disabled: ' + (error as Error).message); return result; }
  }
  for (const entry of entries.filter((entry) => entry.isDirectory() && /^[a-z][a-z0-9-]*$/u.test(entry.name)).sort((a, b) => a.name.localeCompare(b.name))) {
    try {
      const latest = JSON.parse(await readFile(path.join(source.findingsDir, entry.name, 'latest.json'), 'utf8'));
      if (typeof latest.run_id !== 'string' || !runId.test(latest.run_id)) throw new Error('invalid latest run_id');
      const lines = (await readFile(path.join(source.findingsDir, entry.name, 'runs', latest.run_id, 'findings.jsonl'), 'utf8')).split(/\r?\n/u).filter((line) => line.trim());
      const findings = lines.map((line) => validateFinding(JSON.parse(line), entry.name, latest.run_id));
      if (new Set(findings.map((f) => f.id)).size !== findings.length) throw new Error('duplicate finding ids');
      for (const finding of findings) {
        result.read++;
        // Собственный ляп прохода по всей книге: правка готова, нужна только цитата на месте и решение автора.
        if (entry.name === 'amendeor' && finding.category === 'style.book.slip' && typeof finding.metadata.replacement === 'string') {
          const status = statuses.get(finding.id);
          if (status && (!status.evidence || status.evidence === finding.fingerprint.evidence) && ['wontfix', 'false-positive', 'fixed'].includes(status.status)) {
            result.items.push({ id: finding.id, classification: 'skipped', reason: 'status ' + status.status, signals: 0 }); continue;
          }
          const routed = routeFinding(source, finding);
          result.items.push(...routed.items.map((item) => item.classification === 'applicable' ? { ...item, reason: 'slip with a replacement; author consent only', signals: 0 } : item));
          for (const hit of routed.signals) result.slips.push({ id: finding.id, chapter: hit.chapter, scene: hit.scene, start: hit.start, quote: hit.quote, replacement: finding.metadata.replacement, reason: finding.summary });
          if (routed.signals.length) result.applicable++;
          continue;
        }
        if (finding.category !== 'repetition.ngram') { result.items.push({ id: finding.id, classification: 'not-applicable', reason: 'category outside Phase 2 intake', signals: 0 }); continue; }
        const status = statuses.get(finding.id);
        // Это редакторская подсказка, не публикационный gate: учитываем последнюю авторскую/агентскую триажную запись.
        // Решение с другим evidence не относится к текущему вхождению.
        const suppressed = status && (!status.evidence || status.evidence === finding.fingerprint.evidence) && ['wontfix', 'false-positive', 'fixed'].includes(status.status);
        const routed = routeFinding(source, finding);
        if (suppressed) {
          result.protected.push(...routed.signals);
          result.items.push({ id: finding.id, classification: 'skipped', reason: 'status ' + status.status, signals: 0 }); continue;
        }
        if (!finding.evidence.some((e) => e.type === 'quote')) { result.items.push({ id: finding.id, classification: 'not-applicable', reason: 'no quote evidence', signals: 0 }); continue; }
        result.signals.push(...routed.signals); result.items.push(...routed.items);
        if (routed.signals.length) result.applicable++;
      }
    } catch (error) { result.warnings.push(`${entry.name}: findings intake disabled: ${(error as Error).message}`); }
  }
  return result;
}
