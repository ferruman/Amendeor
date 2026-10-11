// Только офлайн: сравнение с pinned Esgardeor, маршрутизация цитат и хэши защищённых книг.
// node eval/phase2-offline.ts --out eval/results/phase2-offline.json
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { readManuscript } from '../../Esgardeor/packages/core/src/manuscript/read.ts';
import { buildTree } from '../../Esgardeor/packages/core/src/tree.ts';
import { loadPack } from '../../Esgardeor/packages/core/src/lang/pack.ts';
import { runMetrics } from '../../Esgardeor/packages/core/src/metrics/index.ts';
import { DEFAULTS } from '../../Esgardeor/packages/core/src/metrics/thresholds.ts';
import { NULL_CACHE } from '../../Esgardeor/packages/core/src/cache.ts';
import { deterministicFindings } from '../../Esgardeor/packages/core/src/metrics/findings.ts';
import { openSource } from '../src/source/index.ts';
import { readFindings } from '../src/findings/intake.ts';
import { editWindows } from '../src/edit/windows.ts';
import { sha256, canonicalJson } from '../src/hash.ts';
const root = path.resolve(import.meta.dirname, '../..');
const work = await mkdtemp(path.join(os.tmpdir(), 'phase2-offline-'));
const nativeFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('offline evaluation forbids network'); };
const run = '2026-10-11T00-00-00Z-abcd';
async function inventory(dir: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const e of (await readdir(dir, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
    const file = path.join(dir, e.name);
    if (e.isDirectory()) for (const [name, hash] of Object.entries(await inventory(file))) files[e.name+'/'+name] = hash;
    else if (e.isFile()) files[e.name] = sha256(await readFile(file));
  }
  return files;
}
try {
  const baselineSha = 'b9fdee20280d6c1fa6e214c153060dfe5e367730';
  await writeFile(path.join(work, 'baseline.ts'), execFileSync('git', ['show', baselineSha+':packages/core/src/metrics/ngrams.ts'], { cwd: path.join(root,'Esgardeor') }));
  const { repeatedNgrams: oldNgrams } = await import(pathToFileURL(path.join(work,'baseline.ts')).href);
  const results: Record<string, unknown> = { baseline_sha: baselineSha, cost_usd: 0, network_calls: 0 };
  for (const name of ['larfenon-2','larfenon']) {
    const workspace = path.join(root,'books',name);
    const snapshot = async () => ({ manuscript: await inventory(path.join(workspace,'manuscript')), edited: await inventory(path.join(workspace,'edited')), manifest: sha256(await readFile(path.join(workspace,'codicora.yaml'))) });
    const initial = await snapshot();
    const raw = await readManuscript(workspace), pack = await loadPack(raw.language), book = buildTree(raw,pack!.pack);
    const metrics = await runMetrics(book,pack,DEFAULTS,NULL_CACHE,run);
    const tokens = book.chapters.flatMap(c => c.scenes.map(s => { const x=metrics.computed.get(c.slug+'/'+s.id)!; return { key:c.slug+'/'+s.id,chapter:c.slug,tokens:x.tokens,lines:x.token_lines }; }));
    const before = oldNgrams(tokens,{ minN:4,minOccurrences:2,maxReported:20,stopwords:new Set(pack!.pack.stopwords) });
    const beforeFindings = deterministicFindings({ book,metrics:{...metrics,report:{...metrics.report,ngrams:before}},run_id:run }).findings.filter(f=>f.category==='repetition.ngram');
    const after = metrics.report.ngrams;
    const findings = deterministicFindings({ book,metrics,run_id:run }).findings.filter(f=>f.category==='repetition.ngram');
    const lost = before.filter((g:any)=>g.occurrences.length>=3 && !after.some(core => (` ${g.text} `).includes(` ${core.text} `) && g.occurrences.every((o:any)=>core.occurrences.some(at=>at.scene===o.scene && at.token>=o.token && at.token+core.n<=o.token+g.n))));
    const historical = await readFindings(await openSource(workspace));
    const source=await openSource(workspace); source.findingsDir=path.join(work,name,'findings');
    const folder=path.join(source.findingsDir,'esgardeor'); await mkdir(path.join(folder,'runs',run),{recursive:true});
    await writeFile(path.join(folder,'latest.json'),JSON.stringify({run_id:run}));
    await writeFile(path.join(folder,'runs',run,'findings.jsonl'),findings.map(f=>JSON.stringify(f)).join('\n'));
    const intake=await readFindings(source); assert.equal(intake.warnings.length,0,intake.warnings.join('\n'));
    const windows=editWindows(source.book,'copy',2048,[],[],intake.signals);
    assert.equal(windows.flatMap(w=>w.signals).length,intake.signals.length);
    const motif=findings.find(f=>f.fingerprint.primary.key==='всему своё время') ?? findings[0]!;
    await writeFile(path.join(source.findingsDir,'_status.jsonl'),JSON.stringify({schema:'codicora.status/0.1',finding_id:motif.id,status:'wontfix',by:'author',at:'2026-10-11T00:00:00Z',evidence:motif.fingerprint.evidence}));
    const protectedIntake=await readFindings(source); assert.equal(protectedIntake.signals.filter(h=>h.id===motif.id).length,0);
    const unchanged=beforeFindings.filter(f=>findings.some(g=>g.fingerprint.primary.key===f.fingerprint.primary.key));
    assert.ok(unchanged.every(f=>findings.some(g=>g.id===f.id)));
    assert.equal(lost.length,0,'recall loss: '+lost.map((g:any)=>g.text).join(', '));
    assert.deepEqual(initial,await snapshot());
    results[name]={ manuscript_hash:sha256(canonicalJson(initial.manuscript)),edited_hash:sha256(canonicalJson(initial.edited)),protected_files_unchanged:true,
      before:{findings:beforeFindings.length,book_scope:beforeFindings.filter(f=>f.scope==='book').length,count_two:before.filter((g:any)=>g.occurrences.length===2).length},
      after:{findings:findings.length,book_scope:findings.filter(f=>f.scope==='book').length,actionable_clusters:intake.applicable,editorial_targets:intake.signals.length,targeted_windows:windows.filter(w=>w.signals.length).length,total_windows:windows.length,stale:intake.items.filter(i=>i.classification==='already-resolved').length,unchanged_phrase_ids:unchanged.length,lost_above_floor:lost.length},
      historical_intake:{read:historical.read,actionable:historical.applicable,signals:historical.signals.length,stale:historical.items.filter(i=>i.classification==='already-resolved').length,warnings:historical.warnings},
      motif_trial:{phrase:motif.fingerprint.primary.key,targets_before:intake.signals.filter(h=>h.id===motif.id).length,targets_after:0,protected:protectedIntake.protected.length},
      clusters:findings.map(f=>({id:f.id,phrase:f.fingerprint.primary.key,scope:f.scope,occurrences:f.evidence.filter(e=>e.type==='quote').length})).sort((a,b)=>b.occurrences-a.occurrences||a.phrase.localeCompare(b.phrase)),
      examples:['ладонь под повязкой','хрон в голове','всему своё время','как у человека который'].map(core=>({phrase:core,before:before.filter((g:any)=>g.text.includes(core)).map((g:any)=>({phrase:g.text,occurrences:g.occurrences.length})),after:after.filter(g=>g.text.includes(core)).map(g=>({phrase:g.text,occurrences:g.occurrences.length}))})) };
  }
  const arg=process.argv.indexOf('--out'), json=JSON.stringify(results,null,2)+'\n';
  if(arg>=0) await writeFile(path.resolve(process.argv[arg+1]!),json); else process.stdout.write(json);
  console.log('Offline corpus evaluation passed; protected files unchanged; cost $0.');
} finally {globalThis.fetch=nativeFetch;await rm(work,{recursive:true,force:true});}
