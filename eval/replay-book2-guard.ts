// Офлайн-повтор прогона Book 2 (larfenon-2, 2026-10-11T16-48-37Z-cc25) из кэша Amendeor: проверяет, что 16 настоящих
// ошибок, которые редактор нашёл, а фильтр отклонил (AUDIT.md F2), видны автору как правки на проверку.
// Книга копируется во временную папку: manuscript/, edited/ и кэш оригинала не меняются. Сеть недоступна: fetch подменён,
// verifier отвечает записанными в run.json полями; где ответа не было (2 сбоя схемы в cc25), — снова без поля preserved.
// Запуск: node eval/replay-book2-guard.ts [--book ../books/larfenon-2] [--run <id>] [--out file.json]
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { Cache, cacheKey } from '../src/cache.ts';
import os from 'node:os';
import path from 'node:path';
import { openSource } from '../src/source/index.ts';
import { loadConfig } from '../src/config.ts';
import { loadPack } from '../src/lang/pack.ts';
import { editMechanical } from '../src/edit/mechanical.ts';

// Цель отклонённой правки (как в rejected.jsonl) → ожидаемая замена; AUDIT.md §4 F2.
export const book2Errors: Array<[string, string]> = [
  ['ваши подвигы', 'ваши подвиги'],
  ['В кратце не значится.', 'Вкратце не значится.'],
  ['Кто-то платит Коула, и платит не из Лакрана.', 'Кто-то платит Коулу, и платит не из Лакрана.'],
  ['на секунную остановку', 'на секундную остановку'],
  ['Мы обменлись новостями.', 'Мы обменялись новостями.'],
  ['что у учителя не описуемое не только лицо', 'что у учителя неописуемое не только лицо'],
  ['я и с мечом хожу не плохо', 'я и с мечом хожу неплохо'],
  ['С один борт от телеги', 'Один борт от телеги'],
  ['— Не получится, — сказал я. — до рассвета у меня коронация', '— Не получится, — сказал я. — До рассвета у меня коронация'],
  ['на этом бумаге заканчивалась', 'на этом бумага заканчивалась'],
  ['поедет я', 'поеду я'],
  ['я обходил его вчера с Степом дважды.', 'я обходил его вчера со Степом дважды.'],
  ['подняла кувшин со камня', 'подняла кувшин с камня'],
  ['в чом', 'в чём'],
  ['сединая прядь', 'седая прядь'],
  ['С этой осади у меня остались', 'С этой осады у меня остались']
];

const italic = (lines: string[]) => [lines.map((line) => `*${line}*`).join('\n'), lines.join('\n')] as const;
const restorations: Array<readonly [string, string, string]> = [
  ['ch-1759d762.md', ...italic(['Огонь не смотрит, куда падает искра;', 'вода не помнит, чьи лица несла.', 'Кто в лес идёт за своей же мыслью,', 'неси её, как носят крыла.'])],
  ['ch-402e17fc.md', italic(['Рог носил он на поясе, друг,', 'И рога́ было мало на свете —', 'Верили все: из одной из трёх рук', 'Выйдут права на земные столетья.'])[0], italic(['Рог носил он на поясе врук,', 'И рога́ было мало на свете —', 'Верили все: из одной из трёх рук', 'Выйдут права на земные столетья.'])[1]]
];

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const option = (name: string) => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined; };
  const runId = option('--run') ?? '2026-10-11T16-48-37Z-cc25';
  const book = path.resolve(option('--book') ?? path.join(import.meta.dirname, '../../books/larfenon-2'));
  const work = await mkdtemp(path.join(os.tmpdir(), 'amendeor-replay-'));
  const requests: Array<{ kind: string; status: number }> = [];
  const original = globalThis.fetch;
  // Окна, чей текст после прогона поменялся (эпиграфы, правка гл. 2), не находят свой ключ кэша. Им отдаётся исторический
  // ответ редактора из того же кэша — непрочитанная запись, все цели которой дословно есть в окне.
  const hit = new Set<string>();
  const read = Cache.prototype.read;
  Cache.prototype.read = async function <T>(this: Cache, stage: string, inputs: unknown): Promise<T | undefined> {
    const value = await read.call(this, stage, inputs) as T | undefined;
    if (value !== undefined && stage === 'model') hit.add(cacheKey(inputs));
    return value;
  };
  const history = JSON.parse(await readFile(path.join(book, '.codicora/amendeor/runs', runId, 'run.json'), 'utf8')) as { guard: { rejections: Array<{ proposal_id: string; target?: string }>; verifications: Array<{ proposal_id: string; answers?: unknown[] }> } };
  const historyProposals = (await readFile(path.join(book, '.codicora/amendeor/runs', runId, 'proposals.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as { id: string; target: { text: string } });
  const targetOf = new Map([...history.guard.rejections.map((item) => [item.proposal_id, item.target ?? ''] as const), ...historyProposals.map((item) => [item.id, item.target.text] as const)]);
  const verdicts = new Map(history.guard.verifications.map((item) => [targetOf.get(item.proposal_id) ?? '', item.answers ?? []]));
  const verdictCalls = new Map<string, number>();
  const answer = (content: string) => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }], usage: { prompt_tokens: 0, completion_tokens: 0 } }), { status: 200 });
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: Array<{ content: string }> };
    if (/necessary/u.test(body.messages?.[0]?.content ?? '')) {
      // Ключ кэша verifier включает абзац; если абзац изменился, ответы берутся из run.json прогона (поля решения по проходам).
      const before = /^BEFORE:\n\n([\s\S]*?)\n\nAFTER:/u.exec(body.messages?.[1]?.content ?? '')?.[1] ?? '';
      const recorded = verdicts.get(before) ?? []; const index = verdictCalls.get(before) ?? 0; verdictCalls.set(before, index + 1);
      requests.push({ kind: recorded[index] ? 'verify-from-run' : 'verify-malformed', status: 200 });
      return answer(recorded[index] ? JSON.stringify({ ...recorded[index], reason: 'replay: recorded in run.json' }) : '{"necessary":false,"reason":"replay: historical answer without preserved"}');
    }
    const prompt = body.messages?.[1]?.content ?? '';
    const dir = path.join(book, '.codicora/amendeor/cache/model');
    for (const file of await readdir(dir)) {
      if (hit.has(file.replace(/\.json$/u, ''))) continue;
      const edits = JSON.parse(await readFile(path.join(dir, file), 'utf8')) as Array<{ target: string }>;
      if (edits.length && edits.every((edit) => prompt.includes(edit.target))) { hit.add(file.replace(/\.json$/u, '')); requests.push({ kind: 'edit-from-cache', status: 200 }); return answer(JSON.stringify({ edits })); }
    }
    requests.push({ kind: 'edit-unrecorded', status: 200 });
    return answer('{"edits":[]}');
  }) as typeof fetch;
  process.env.AMENDEOR_OPENROUTER_API_KEY ||= 'offline-replay';
  try {
    for (const item of ['codicora.yaml', 'manuscript', 'edited', '.codicora/amendeor/cache', '.codicora/amendeor/rejected-by-author.jsonl']) {
      await cp(path.join(book, item), path.join(work, item), { recursive: true }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
    }
    // После прогона автор перевёл эпиграфы гл. 6 и 20 в курсив и заменил «врук» (PRODUCTION-REPORT.md 18:20–18:30); в копии
    // восстанавливается текст на момент прогона. Совпадение ключей кэша окон подтверждает восстановление побайтно.
    for (const [file, from, to] of restorations) {
      const chapter = path.join(work, 'manuscript/chapters', file);
      const text = await readFile(chapter, 'utf8');
      if (!text.includes(from)) throw new Error(`restoration does not apply to ${file}`);
      await writeFile(chapter, text.replace(from, to));
    }
    // Конфигурация — ровно та, что записана в run.json исторического прогона: от неё зависят ключи кэша.
    const recorded = JSON.parse(await readFile(path.join(book, '.codicora/amendeor/runs', runId, 'run.json'), 'utf8')) as { config: unknown };
    await writeFile(path.join(work, 'user-config.json'), JSON.stringify(recorded.config));
    const source = await openSource(work);
    const loaded = await loadConfig({ workspaceDir: work, env: { ...process.env, AMENDEOR_CONFIG: path.join(work, 'user-config.json') } });
    loaded.config.language = source.book.lang;
    const pack = await loadPack(source.book.lang, source.book.chapters.map((chapter) => chapter.text).join('\n'));
    const started = performance.now();
    const result = await editMechanical(source, loaded, pack, { mode: 'copy' });
    const guard = result.run.guard as Record<string, any>;
    const model = (result.run.stages as Array<Record<string, any>>).find((stage) => stage.name === 'model')!;
    const reviewOnly = result.proposals.filter((proposal) => proposal.source === 'model' && proposal.unverified);
    const errors = book2Errors.map(([target, replacement]) => {
      const proposal = result.proposals.find((item) => item.target.text === target && item.replacement === replacement);
      const rejection = (guard.rejections as Array<{ target?: string; guard: string; reason: string }>).find((item) => item.target === target);
      return { target, replacement, outcome: proposal ? (proposal.unverified ? 'review-only' : 'offered') : rejection ? `rejected by ${rejection.guard}: ${rejection.reason.split('\n')[0]}` : 'missing',
        accept_without_consent: proposal ? !proposal.unverified || proposal.impact === 'mechanical' : false };
    });
    const summary = {
      book, run_id: result.run_id, seconds: Math.round(performance.now() - started) / 1000,
      model: { windows: model.windows, cached: model.cached, sent: model.sent, candidates: model.candidates, failures: model.failures?.length, status: model.status, reason: model.reason },
      guard: { status: guard.status, candidates: guard.candidates, offered: guard.offered, review_only: guard.review_only, rejected: guard.rejections.length, failures: guard.failures?.length ?? 0, verifier_failures: guard.verifier_failures, provider_failures: guard.provider_failures,
        semantic_rejected: guard.semantic_rejected, voice_rejected: guard.voice_rejected, rule_preferred: guard.rule_preferred },
      proposals: { total: result.proposals.length, mechanical: result.proposals.filter((item) => item.impact === 'mechanical').length, model_offered: result.proposals.filter((item) => item.source === 'model' && !item.unverified).length, review_only: reviewOnly.length },
      network: { requests: requests.length, by_kind: requests.reduce<Record<string, number>>((acc, item) => ({ ...acc, [item.kind]: (acc[item.kind] ?? 0) + 1 }), {}) },
      book2_errors: { review_only: errors.filter((item) => item.outcome === 'review-only').length, offered: errors.filter((item) => item.outcome === 'offered').length, lost: errors.filter((item) => !['review-only', 'offered'].includes(item.outcome)).length, acceptable_without_consent: errors.filter((item) => item.accept_without_consent).length, items: errors },
      offered_ids: result.proposals.filter((item) => item.source === 'model' && !item.unverified).map((item) => item.id).sort(),
      review_only_items: reviewOnly.map((item) => ({ target: item.target.text, replacement: item.replacement, evidence: item.review?.evidence })),
      rejections: (guard.rejections as Array<{ guard: string; reason: string; target?: string; replacement?: string }>).map((item) => ({ guard: item.guard, reason: item.reason.split('\n')[0]!.slice(0, 100), target: item.target, replacement: item.replacement })),
      failures: guard.failures ?? []
    };
    const text = JSON.stringify(summary, null, 2);
    const out = option('--out');
    if (out) await writeFile(out, text + '\n');
    process.stdout.write(text + '\n');
  } finally { globalThis.fetch = original; Cache.prototype.read = read; await rm(work, { recursive: true, force: true }); }
}

if (import.meta.main) await main();
