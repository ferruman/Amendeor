import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { openSource, type OpenedSource } from './source/index.ts';
import { readRun } from './run/store.ts';
import { acquireLock } from './run/lock.ts';
import { acceptProposals, readAccepted, readRejected, rejectProposals } from './edited/decisions.ts';
import { buildEdited, planEdited } from './edited/build.ts';
import { loadConfig, type LoadedConfig } from './config.ts';
import { loadPack } from './lang/pack.ts';
import { editMechanical } from './edit/mechanical.ts';
import { locate } from './proposal/locate.ts';
import { TITLE_SCENE_ID } from './book.ts';

// Локальный UI: библиотека загруженных текстов плюс рабочие пространства Codicora из аргументов.
// Всё решает тот же код, что и CLI; сервер только переводит HTTP в эти вызовы.

const uiDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ui');
const staticFiles: Record<string, string> = { '/': 'index.html', '/app.js': 'app.js', '/app.css': 'app.css' };
const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const modes = ['mechanical', 'proofread', 'copy', 'full'];

interface Doc { id: string; name: string; lang?: string; target: string; kind: 'library' | 'workspace' }
interface Job { mode: string; started_at: string; error?: string }

export async function serve(argv: string[]): Promise<void> {
  let port = 4178; let library = path.join(os.homedir(), 'Amendeor'); const workspaces: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const item = argv[index]!;
    if (item === '--port') port = Number(argv[++index]);
    else if (item === '--library') library = path.resolve(argv[++index] ?? '');
    else if (item.startsWith('-')) throw new Error(`unknown option: ${item}`);
    else workspaces.push(path.resolve(item));
  }
  if (!Number.isInteger(port) || port <= 0) throw new Error('--port requires a number');
  await mkdir(library, { recursive: true });
  const server = createServer({ library, workspaces });
  server.listen(port, '127.0.0.1', () => process.stdout.write(`amendeor: http://127.0.0.1:${port} · library ${library}\n`));
}

export function createServer(options: { library: string; workspaces: string[] }): http.Server {
  const jobs = new Map<string, Job>();

  async function listDocs(): Promise<Doc[]> {
    const docs: Doc[] = [];
    for (const name of (await readdir(options.library).catch(() => [])).sort()) {
      const meta = await readFile(path.join(options.library, name, 'meta.json'), 'utf8').then((text) => JSON.parse(text) as { name: string; lang: string }).catch(() => undefined);
      if (meta) docs.push({ id: name, name: meta.name, lang: meta.lang, target: path.join(options.library, name, 'text'), kind: 'library' });
    }
    for (const [index, dir] of options.workspaces.entries()) docs.push({ id: `ws-${index}`, name: path.basename(dir), target: dir, kind: 'workspace' });
    return docs;
  }

  async function open(doc: Doc): Promise<{ source: OpenedSource; config: LoadedConfig }> {
    const config = await loadConfig({ cli: doc.lang ? { language: doc.lang } : undefined });
    const source = await openSource(doc.target, { lang: doc.lang ?? config.config.language });
    const loaded = source.workspaceDir ? await loadConfig({ workspaceDir: source.workspaceDir }) : config;
    loaded.config.language = source.book.lang;
    return { source, config: loaded };
  }

  async function view(doc: Doc) {
    const { source, config } = await open(doc);
    const history = await readAccepted(source.editedDir);
    const accepted = new Set(history.map((item) => item.proposal.id));
    const applied = new Map(planEdited(source.book, history).results.map((item) => [item.id, item]));
    const rejected = new Set((await readRejected(source.stateDir)).map((item) => item.proposal_id));
    const latest = await readRun(source.stateDir, 'latest').catch(() => undefined);
    const run = latest?.run as Record<string, any> | undefined;
    // Принятые правки прежних запусков тоже могут устареть или конфликтовать.
    const byId = new Map((latest?.proposals ?? []).map((proposal) => [proposal.id, proposal]));
    for (const item of history) byId.set(item.proposal.id, item.proposal);
    const proposals = [...byId.values()].map((proposal) => {
      const chapter = source.book.chapters.find((item) => item.slug === proposal.location.chapter);
      const scene = chapter?.scenes.find((item) => item.id === proposal.location.scene);
      const text = proposal.location.scene === TITLE_SCENE_ID ? chapter?.title : scene?.text;
      let found: ReturnType<typeof locate> = { stale: true };
      try { if (text !== undefined) found = locate(text, { ...proposal.target, replacement: proposal.replacement }); } catch { /* Неприменимая правка показывается как устаревшая. */ }
      // Смещение в тексте главы; у правки заголовка его нет — она показывается только в списке.
      const offset = 'ok' in found && scene ? { start: scene.start + found.start, end: scene.start + found.end } : {};
      const result = applied.get(proposal.id);
      const status = accepted.has(proposal.id) ? (result?.status === 'applied' || result?.status === 'moved' ? 'accepted' : result?.status ?? 'stale') : rejected.has(proposal.id) ? 'rejected' : 'ok' in found ? 'pending' : 'stale';
      return { id: proposal.id, chapter: proposal.location.chapter, scene: proposal.location.scene, category: proposal.category, impact: proposal.impact, source: proposal.source,
        confidence: proposal.confidence, reason: proposal.reason, verification: proposal.verification, unverified: proposal.unverified ?? false,
        target: proposal.target.text, replacement: proposal.replacement, status, detail: result?.detail, ...offset };
    });
    return {
      id: doc.id, name: doc.name, kind: doc.kind, lang: source.book.lang,
      chapters: source.book.chapters.map((chapter) => ({ slug: chapter.slug, title: chapter.title, text: chapter.text })),
      proposals, job: jobs.get(doc.id) ?? null, model: Boolean(config.config.profiles.edit), modes,
      run: run ? { run_id: run.run_id, mode: run.metadata?.mode, finished_at: run.finished_at, ledger: run.ledger, withheld: run.guard?.rejections ?? [],
        failures: (run.stages ?? []).flatMap((stage: { failures?: unknown[] }) => stage.failures ?? []) } : null
    };
  }

  function startRun(doc: Doc, mode: string): void {
    const job: Job = { mode, started_at: new Date().toISOString() };
    jobs.set(doc.id, job);
    void (async () => {
      const { source, config } = await open(doc);
      if (mode !== 'mechanical' && !config.config.profiles.edit) throw new Error('this mode needs a model: configure profiles.edit');
      const pack = await loadPack(source.book.lang, source.book.chapters.map((chapter) => chapter.text).join('\n'));
      const release = await acquireLock(source.stateDir);
      try { await editMechanical(source, config, pack, { noCache: false, mode, acceptAs: async () => ({ acceptedBy: 'human:ui' }) }); } finally { await release(); }
      jobs.delete(doc.id);
    })().catch((error: unknown) => { job.error = error instanceof Error ? error.message : String(error); });
  }

  async function decide(doc: Doc, action: 'accept' | 'reject', ids: string[], unverified: boolean): Promise<void> {
    const { source } = await open(doc);
    const run = await readRun(source.stateDir, 'latest');
    const selected = run.proposals.filter((proposal) => ids.includes(proposal.id));
    if (selected.length !== ids.length) throw new Error('proposal not in the latest run');
    const release = await acquireLock(source.stateDir);
    try {
      if (action === 'reject') { await rejectProposals(source.stateDir, selected); return; }
      const accepted = await acceptProposals(source.editedDir, selected, { allowUnverified: unverified, acceptedBy: 'human:ui' });
      await buildEdited({ book: source.book, editedDir: source.editedDir, accepted, manifestText: source.manifestText });
    } finally { await release(); }
  }

  async function editedText(doc: Doc): Promise<string> {
    const { source } = await open(doc);
    const release = await acquireLock(source.stateDir);
    try { await buildEdited({ book: source.book, editedDir: source.editedDir, accepted: await readAccepted(source.editedDir), manifestText: source.manifestText }); }
    finally { await release(); }
    const parts = await Promise.all(source.book.chapters.map((chapter) => readFile(path.join(source.editedDir, chapter.relativeFile ?? `chapters/${chapter.slug}.md`), 'utf8')));
    return parts.join('\n\n');
  }

  async function create(body: { name?: unknown; lang?: unknown; files?: unknown }): Promise<string> {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const files = Array.isArray(body.files) ? body.files as Array<{ name?: unknown; text?: unknown }> : [];
    if (!name) throw new Error('name is required');
    if (body.lang !== 'ru' && body.lang !== 'en') throw new Error('lang must be ru or en');
    if (!files.length || files.some((file) => typeof file.text !== 'string' || !file.text.trim())) throw new Error('text is empty');
    const id = `${slug(name) || 'text'}-${randomBytes(2).toString('hex')}`;
    const dir = path.join(options.library, id, 'text');
    await mkdir(dir, { recursive: true });
    // Префикс номера держит порядок глав таким, каким их загрузили.
    for (const [index, file] of files.entries()) {
      const base = slug(typeof file.name === 'string' ? file.name.replace(/\.(md|txt)$/i, '') : '') || 'text';
      await writeFile(path.join(dir, `${String(index + 1).padStart(2, '0')}-${base}.md`), file.text as string, 'utf8');
    }
    await writeFile(path.join(options.library, id, 'meta.json'), `${JSON.stringify({ name, lang: body.lang, created_at: new Date().toISOString() }, null, 2)}\n`);
    return id;
  }

  return http.createServer(async (request, response) => {
    const send = (status: number, value: unknown, type = 'application/json; charset=utf-8') => {
      response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
      response.end(typeof value === 'string' ? value : JSON.stringify(value));
    };
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      // Сервер слушает только 127.0.0.1; чужая вкладка браузера всё равно может слать POST — отсекаем по Origin.
      // Страница, перепривязавшая своё имя на 127.0.0.1 (DNS rebinding), сама себе same-origin — её выдаёт только Host.
      if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(request.headers.host ?? 'localhost')) return send(403, { error: 'loopback only' });
      const origin = request.headers.origin;
      if (request.method !== 'GET' && origin && new URL(origin).host !== request.headers.host) return send(403, { error: 'cross-origin request refused' });
      const file = staticFiles[url.pathname];
      if (request.method === 'GET' && file) return send(200, await readFile(path.join(uiDir, file), 'utf8'), types[path.extname(file)]);
      if (url.pathname === '/api/docs' && request.method === 'GET') return send(200, (await listDocs()).map(({ id, name, kind }) => ({ id, name, kind, running: jobs.has(id) && !jobs.get(id)!.error })));
      if (url.pathname === '/api/docs' && request.method === 'POST') return send(201, { id: await create(await readBody(request)) });
      const match = /^\/api\/docs\/([^/]+)(?:\/(run|accept|reject|edited))?$/.exec(url.pathname);
      const doc = match && (await listDocs()).find((item) => item.id === decodeURIComponent(match[1]!));
      if (!match || !doc) return send(404, { error: 'not found' });
      const action = match[2];
      if (!action && request.method === 'GET') return send(200, await view(doc));
      if (action === 'edited' && request.method === 'GET') return send(200, await editedText(doc), 'text/markdown; charset=utf-8');
      if (request.method !== 'POST') return send(405, { error: 'method not allowed' });
      const body = await readBody(request);
      if (action === 'run') {
        if (!modes.includes(body.mode as string)) return send(400, { error: 'unknown mode' });
        if (jobs.has(doc.id) && !jobs.get(doc.id)!.error) return send(409, { error: 'a run is already in progress' });
        startRun(doc, body.mode as string); return send(202, { started: true });
      }
      if (action === 'accept' || action === 'reject') {
        const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === 'string') : [];
        if (!ids.length) return send(400, { error: 'ids are required' });
        await decide(doc, action, ids, body.unverified === true); return send(200, { ok: true });
      }
      return send(404, { error: 'not found' });
    } catch (error) {
      send(400, { error: error instanceof Error ? error.message : String(error) });
    }
  });
}

function slug(value: string): string {
  return value.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

async function readBody(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > 50 * 1024 * 1024) throw new Error('request body too large');
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return {};
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('body must be a JSON object');
  return parsed as Record<string, unknown>;
}
