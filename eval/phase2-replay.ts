// Офлайн-паритет с Phase 1 на замороженных корпусах. Неизвестный запрос получает 503; сеть недоступна.
// Запуск: node eval/phase2-replay.ts --out eval/results/phase2-replay.json
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
const root=path.resolve(import.meta.dirname,'..');
const work=await mkdtemp(path.join(os.tmpdir(),'phase2-replay-'));
const nativeFetch=globalThis.fetch;
const baseline='0e38c0d2b2004cd480f20d25930775c4a54ad67d';
try {
  const old=path.join(work,'baseline'); await mkdir(old);
  const archive=execFileSync('git',['archive',baseline,'src','amendeor.yaml'],{cwd:root});
  execFileSync('tar',['-x','-C',old],{input:archive});
  await writeFile(path.join(old,'package.json'),'{"type":"module"}');
  await symlink(path.join(root,'node_modules'),path.join(old,'node_modules'));
  const results:any[]=[];
  for(const corpus of ['furnace2','furnace2-clean','ru-new','ru-new-clean','nonstd-clean']) {
    const dir=path.join(root,'eval/results/2026-10-11-rule-safety',corpus);
    const rows=(await readFile(path.join(dir,'requests.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
    const jobs=[...new Set(rows.filter(r=>r.stage==='stage-b').map(r=>r.job as string))].sort();
    for(const job of jobs) {
      const [configuration,workspace]=job.split('/');
      const resultFile=path.join(dir,'stage-b',configuration!,workspace!,'result.json');
      const recorded=JSON.parse(await readFile(resultFile,'utf8'));
      const settings=recorded.config;
      const executions:any[]=[];
      for(const [label,implementation] of [['phase1',old],['phase2',root]]) {
        console.log(corpus+'/'+job+' '+label);
        const folder=path.join(work,label!,corpus,configuration!,workspace!); await cp(path.join(dir,'corpus',recorded.work),folder,{recursive:true});
        const {configSchema}=await import(pathToFileURL(path.join(implementation!,'src/config.ts')).href);
        const provider=(family:string)=>({transport:'openai',endpoint:'https://openrouter.ai/api/v1/chat/completions',api_key:'offline',family});
        const config=configSchema.parse({preserve:[],providers:{editor:provider('openai'),verifier:provider('anthropic')},profiles:{edit:{provider:'editor',model:'openai/gpt-6-luna',temperature:0,reasoning:false,context_budget:2048,...(settings.edit_diagnostic?{diagnostic:true}:{})},verify:{provider:'verifier',model:'anthropic/claude-haiku-5.5',passes:3,reasoning:true,reasoning_effort:'medium',check:settings.check,...(settings.verify_context?{context:true}:{})}}});
        const {Gateway}=await import(pathToFileURL(path.join(implementation!,'src/provider/gateway.ts')).href);
        const complete=Gateway.prototype.complete;
        Gateway.prototype.complete=function(...args:any[]) { (this as any).nextOpenRouterRequestAt=0; return complete.apply(this,args); };
        const {openSource}=await import(pathToFileURL(path.join(implementation!,'src/source/index.ts')).href);
        const {loadPack}=await import(pathToFileURL(path.join(implementation!,'src/lang/pack.ts')).href);
        const {editMechanical}=await import(pathToFileURL(path.join(implementation!,'src/edit/mechanical.ts')).href);
        const source=await openSource(folder),pack=await loadPack(source.book.lang);
        const queue=rows.filter(r=>r.job===job && r.request).map(r=>({...r,used:false}));
        let unrecorded=0; const requests:string[]=[];
        globalThis.fetch=async (_url,init)=>{
          const body=String(init?.body); requests.push(body);
          const row=queue.find(r=>!r.used && JSON.stringify(r.request)===body);
          if(!row){unrecorded++;return new Response(JSON.stringify({error:{message:'unrecorded offline request'}}),{status:503});}
          row.used=true;
          const response=structuredClone(row.response); if(response.usage) response.usage.cost=0;
          return new Response(JSON.stringify(response),{status:row.status});
        };
        const result=await editMechanical(source,{config,winningLayer:{},warnings:[]},pack,{mode:'copy',noCache:true});
        Gateway.prototype.complete=complete;
        const proposalBytes=(await readFile(path.join(source.stateDir,'runs',result.run_id,'proposals.jsonl'),'utf8')).replaceAll(result.run_id,'RUN');
        const rejectionBytes=await readFile(path.join(source.stateDir,'runs',result.run_id,'rejected.jsonl'),'utf8');
        executions.push({label,proposalBytes,rejectionBytes,requests,unrecorded,proposals:result.proposals.length,failures:(result.run.guard as any).failures.length});
      }
      assert.equal(executions[0].proposalBytes,executions[1].proposalBytes,corpus+'/'+job+' proposals');
      assert.equal(executions[0].rejectionBytes,executions[1].rejectionBytes,corpus+'/'+job+' rejections');
      assert.deepEqual(executions[0].requests,executions[1].requests,corpus+'/'+job+' request bodies');
      results.push({corpus,job,proposals:executions[1].proposals,requests:executions[1].requests.length,unrecorded:executions[1].unrecorded,phase1_failures:executions[0].failures,phase2_failures:executions[1].failures,proposal_parity:true,rejection_parity:true,request_parity:true});
    }
    console.log(corpus+': '+results.filter(r=>r.corpus===corpus).length+' jobs replayed');
  }
  const report={baseline_sha:baseline,cost_usd:0,network_calls:0,jobs:results.length,unrecorded:results.reduce((n,r)=>n+r.unrecorded,0),run_id_normalization:'only the new run id is replaced with RUN before byte comparison',results};
  const arg=process.argv.indexOf('--out'); if(arg>=0) await writeFile(path.resolve(process.argv[arg+1]!),JSON.stringify(report,null,2)+'\n');
  console.log('All replayed proposals, rejections and HTTP bodies match Phase 1. Cost $0.');
} finally {globalThis.fetch=nativeFetch;await rm(work,{recursive:true,force:true});}
