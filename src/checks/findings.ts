// Находки проверок по гайдам в общем формате Codicora Findings v0.1 (../../../FINDINGS.md): findings/amendeor/.
// Это диагностика, не правки: правку с заменой Amendeor предлагает в edit; здесь — место и причина, чтобы
// Fabellatrix показал их рядом с главой, а Imprimeor мог поставить на них гейт. Пишется только по --findings.
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Book } from '../book.ts';
import { canonicalJson, normalizeQuote, normalizeText, sha256 } from '../hash.ts';
import type { GuideFinding } from './guide.ts';

const TOOL = { name: 'amendeor', version: '0.1.0' };
const hex16 = (value: string) => sha256(value).slice('sha256:'.length, 'sha256:'.length + 16);
const runIdNow = (now: Date) => `${now.toISOString().slice(0, 19).replace(/:/g, '-')}Z-${randomBytes(2).toString('hex')}`;

type Contextual = { kind?: string; confidence?: number };

export function toFindings(book: Book, items: Array<GuideFinding & Contextual>, runId: string, root: string) {
  return items.map((item) => {
    const chapterIndex = book.chapters.findIndex((c) => c.slug === item.chapter);
    const chapter = book.chapters[chapterIndex]!;
    const sceneIndex = chapter.scenes.findIndex((s) => s.id === item.scene);
    const scene = chapter.scenes[sceneIndex]!;
    // Категория — принцип гайда в семействе style: style.gal.action-noun, style.info.stop-words.
    const category = `style.${item.principle}`.toLowerCase().replace(/[^a-z0-9.-]+/g, '-');
    const primary = { category, chapter: chapter.slug, scene: scene.id, key: normalizeQuote(item.quote).toLowerCase().slice(0, 80) };
    const quote = { type: 'quote', scene: scene.id, text: item.quote, hash: sha256(normalizeQuote(item.quote)) };
    const line = scene.text.slice(0, Math.max(0, item.start)).split('\n').length;
    return {
      schema: 'codicora.finding/0.1',
      id: `${TOOL.name}:${hex16(canonicalJson(primary))}`,
      fingerprint: { primary, evidence: sha256(`quote:${scene.id}:${quote.hash}`) },
      run_id: runId,
      tool: TOOL,
      category,
      kind: 'concern',
      severity: item.severity ?? 'low',
      confidence: item.kind === 'contextual' ? item.confidence ?? 0.7 : 1,
      scope: 'scene',
      location: {
        primary: { chapter: chapter.slug, scene: scene.id, path: `ch${String(chapterIndex + 1).padStart(2, '0')}/s${String(sceneIndex + 1).padStart(2, '0')}`, file: path.relative(root, chapter.file), lines: [line, line + item.quote.split('\n').length - 1], content_hash: sha256(normalizeText(scene.text)) },
        related: [],
      },
      evidence: [quote],
      summary: item.reason,
      explanation: `${item.guide}: ${item.principle}${item.source_pages ? ` (${item.source_pages})` : ''}.`,
      status: 'open',
      metadata: { guide: item.guide, signal: item.id, provenance: item.provenance },
    };
  });
}

/** Прогон целиком во временную папку → rename → latest.json атомарно (FINDINGS.md §5). */
export async function writeFindingsRun(findingsDir: string, root: string, book: Book, items: Array<GuideFinding & Contextual>, { guide, startedAt, now = new Date(), stages = [{ name: 'check', status: 'ok' }] }: { guide: string; startedAt: string; now?: Date; stages?: Array<{ name: string; status: 'ok' | 'partial' | 'failed' | 'skipped'; failures?: Array<{ node_id: string; reason: string }> }> }) {
  const runId = runIdNow(now);
  const toolDir = path.join(findingsDir, TOOL.name);
  const unique = [...new Map(toFindings(book, items, runId, root).map((f) => [f.id, f])).values()];
  let previous: { run_id: string | null; evidence: Map<string, string> } = { run_id: null, evidence: new Map() };
  try {
    const { run_id: prev } = JSON.parse(await readFile(path.join(toolDir, 'latest.json'), 'utf8')) as { run_id: string };
    const lines = (await readFile(path.join(toolDir, 'runs', prev, 'findings.jsonl'), 'utf8')).split('\n').filter((l) => l.trim());
    previous = { run_id: prev, evidence: new Map(lines.map((l) => { const f = JSON.parse(l) as { id: string; fingerprint: { evidence: string } }; return [f.id, f.fingerprint.evidence]; })) };
  } catch { /* первый прогон */ }
  const states: Record<string, string> = {};
  for (const f of unique) states[f.id] = !previous.evidence.has(f.id) ? 'new' : previous.evidence.get(f.id) === f.fingerprint.evidence ? 'unchanged' : 'updated';
  for (const id of previous.evidence.keys()) states[id] ??= 'absent';
  const run = {
    schema: 'codicora.run/0.1', run_id: runId, tool: TOOL, started_at: startedAt, finished_at: new Date().toISOString(),
    // Файлы как прочитаны: путь от workspace, хэш нормализованного текста — по нему читатель проверит свежесть.
    inputs: { files: book.chapters.map((c) => ({ path: path.relative(root, c.file), content_hash: sha256(normalizeText(c.text)) })) },
    // Стадии как прошли: частичный контекстный проход — partial, а не ok (потребитель отличит неполную проверку).
    config: { guide }, stages, ledger: {},
    baseline: { previous_run_id: previous.run_id, states },
    counts: { by_kind: unique.length ? { concern: unique.length } : {}, by_severity: unique.reduce<Record<string, number>>((counts, f) => ({ ...counts, [f.severity]: (counts[f.severity] ?? 0) + 1 }), {}) },
    metadata: {},
  };
  const tmp = path.join(toolDir, 'runs', `.tmp-${runId}`);
  await mkdir(tmp, { recursive: true });
  await writeFile(path.join(tmp, 'findings.jsonl'), unique.map((f) => JSON.stringify(f)).join('\n') + (unique.length ? '\n' : ''));
  await writeFile(path.join(tmp, 'run.json'), `${JSON.stringify(run, null, 2)}\n`);
  await rename(tmp, path.join(toolDir, 'runs', runId));
  await writeFile(path.join(toolDir, `latest.json.${runId}.tmp`), JSON.stringify({ run_id: runId }));
  await rename(path.join(toolDir, `latest.json.${runId}.tmp`), path.join(toolDir, 'latest.json'));
  return { runId, dir: path.join(toolDir, 'runs', runId), count: unique.length };
}
