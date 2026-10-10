import {readFile,readdir,writeFile} from 'node:fs/promises';
import {locate} from '../src/proposal/locate.ts';
const dir=new URL('./results/'+(process.argv[2]??'2026-10-10-model-comparison')+'/',import.meta.url);
const corpus=JSON.parse(await readFile(new URL('corpus.json',dir)));
const results=[];
for(const f of await readdir(dir)){
 if(!/^(openai|anthropic|deepseek|qwen|meta-llama)-.*-(ru|en)-[01]\.json$/.test(f))continue;
 results.push(JSON.parse(await readFile(new URL(f,dir))));
}
function exact(set,proposals){
 const matches=[];
 for(const m of set.mutations){
  const scene=set.book.chapters.find(c=>c.slug===m.chapter).scenes.find(s=>s.id===m.scene).text;
  for(const p of proposals.filter(p=>p.location.chapter===m.chapter&&p.location.scene===m.scene)){
   const l=locate(scene,p.target);if(!('ok' in l))continue;
   if(l.start>m.span.end||l.end<m.span.start)continue;
   const a=Math.min(l.start,m.span.start),b=Math.max(l.end,m.span.end);
   const got=scene.slice(a,l.start)+p.replacement+scene.slice(l.end,b);
   const expected=scene.slice(a,m.span.start)+m.original+scene.slice(m.span.end,b);
   if(got===expected){matches.push({mutation:m.id,type:m.type,proposal:p.id});break;}
  }
 }
 return matches;
}
const rows=results.map(r=>{
 const s=corpus.find(c=>c.work===r.work);
 const exactRaw=exact(s,r.proposals),exactSafe=exact(s,r.safe_proposals);
 return {model:r.model,work:r.work,repeat:r.repeat,total:s.mutations.length,detected:r.raw_score.matched.length,exact:exactRaw.length,exact_safe:exactSafe.length,control:r.raw_score.unnecessary.control_proposals,protected:r.raw_score.unnecessary.preserve_proposals,unlabelled:r.raw_score.unnecessary.count,proposals:r.proposals.length,safe:r.safe_proposals.length,failures:r.stage.failures.length,windows:r.stage.windows,exact_matches:exactRaw,safe_matches:exactSafe};
});
const requests=(await readFile(new URL('requests.jsonl',dir),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
const summary=[...new Set(rows.map(r=>r.model))].map(model=>{
 const own=rows.filter(r=>r.model===model),req=requests.filter(r=>r.model===model);
 const counts=work=>own.filter(r=>r.work===work).map(r=>({exact:r.exact,detected:r.detected,total:r.total,safe:r.exact_safe}));
 const times=req.map(r=>r.ms).sort((a,b)=>a-b);
 return {model,ru:counts('kashtanka-ru'),en:counts('jekyll-en'),control:own.reduce((s,r)=>s+r.control,0),protected:own.reduce((s,r)=>s+r.protected,0),unlabelled:own.reduce((s,r)=>s+r.unlabelled,0),failed_windows:own.reduce((s,r)=>s+r.failures,0),windows:own.reduce((s,r)=>s+r.windows,0),requests:req.length,cost_usd:req.reduce((s,r)=>s+r.cost,0),median_request_ms:times[Math.floor(times.length/2)],truncated_attempts:req.filter(r=>r.response.choices?.[0]?.finish_reason==='length').length,reasoning_tokens:req.reduce((n,r)=>n+(r.response.usage?.completion_tokens_details?.reasoning_tokens??0),0)};
});
await writeFile(new URL('summary.json',dir),JSON.stringify({scope:'editor + deterministic guards; no model verifier',rows,summary},null,2));
console.log(JSON.stringify(summary,null,2));