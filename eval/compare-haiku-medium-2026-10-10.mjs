import {readFile,mkdir,writeFile,appendFile} from 'node:fs/promises';
import {parse as parseYaml} from 'yaml';
import {openSource} from '../src/source/index.ts';
import {modelPass} from '../src/edit/pass.ts';
import {configSchema} from '../src/config.ts';
import {loadPack} from '../src/lang/pack.ts';
import {scoreProposals} from './score.ts';
import {semanticTrap} from '../src/guard/traps.ts';
import {voiceGuard} from '../src/guard/voice.ts';
import {locate} from '../src/proposal/locate.ts';
import {dialogueSpans,inDialogue} from '../src/text/dialogue.ts';
import {sha256} from '../src/hash.ts';

const out = new URL('./results/2026-10-10-haiku-medium/', import.meta.url);
await mkdir(out,{recursive:true});
const models=['anthropic/claude-haiku-5.5'];
const nativeFetch=globalThis.fetch;
const catalog=(await (await nativeFetch('https://openrouter.ai/api/v1/models')).json()).data;
const metadata=models.map(id=>{const m=catalog.find(m=>m.id===id); if(!m)throw Error('model absent '+id);return {id,pricing:m.pricing,reasoning:m.reasoning};});
await writeFile(new URL('models.json',out),JSON.stringify(metadata,null,2));
const secret=parseYaml(await readFile('/Users/victor/.config/codicora/collationator.yaml','utf8')).jev.api_key;
if(!secret)throw Error('OpenRouter key not configured');
let reserved=0,spent=0,calls=0;
try {
 const old=(await readFile(new URL('requests.jsonl',out),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
 spent=old.reduce((n,r)=>n+r.cost,0);calls=old.length;
} catch(e) {if(e.code!=='ENOENT')throw e;}
const previous=JSON.parse(await readFile(new URL('./results/2026-10-10-model-comparison/results.json',import.meta.url)));
const cap=3-previous.actual_cost_usd;
globalThis.fetch=async(url,opts)=>{
 if(!String(url).includes('/chat/completions'))return nativeFetch(url,opts);
 const body=JSON.parse(opts.body),m=metadata.find(m=>m.id===body.model);
 body.reasoning={enabled:true,effort:'medium'};
 opts={...opts,body:JSON.stringify(body)};
 const inputChars=body.messages.reduce((n,x)=>n+x.content.length,0);
 const worst=inputChars*Number(m.pricing.prompt)+body.max_tokens*Number(m.pricing.completion);
 if(reserved+spent+worst>cap)throw Error('Experiment budget cap reached');
 reserved+=worst; calls++;
 const start=Date.now();
 try {
  const res=await nativeFetch(url,opts);
  const raw=await res.text();
  let parsed;try{parsed=JSON.parse(raw);}catch{}
  const usage=parsed?.usage;
  const estimated=usage ? usage.prompt_tokens*Number(m.pricing.prompt)+usage.completion_tokens*Number(m.pricing.completion):worst;
  const cost=typeof usage?.cost==='number'?usage.cost:estimated;
  spent+=cost;
  await appendFile(new URL('requests.jsonl',out),JSON.stringify({model:body.model,ms:Date.now()-start,status:res.status,max_tokens:body.max_tokens,reasoning:body.reasoning,messages:body.messages,response:parsed??raw,cost,cost_source:typeof usage?.cost==='number'?'provider':'catalog-or-reserved'})+'\n');
  return new Response(raw,{status:res.status,headers:res.headers});
 }catch(e){spent+=worst;throw e;}
 finally{reserved-=worst;}
};
const sets=[];
for(const work of ['kashtanka-ru','jekyll-en']){
 const root=new URL('./fixtures/'+work+'/',import.meta.url);
 const source=await openSource(new URL('mutated-formulaic/',root).pathname);
 const fixture=JSON.parse(await readFile(new URL('fixture.json',root)));
 const {mutations}=JSON.parse(await readFile(new URL('formulaic-mutations.json',root)));
 const {spans}=JSON.parse(await readFile(new URL('preserve.json',root)));
 // Фиксированная выборка: объективные ошибки, ошибки прозы, защищённые реплики и чистая сцена.
 const selected=work==='kashtanka-ru'
 ? ['01-kashtanka/369de60f-5e2d-4172-8e91-7a3df8c62150','02-kashtanka/8664ef28-76b4-4529-8d9c-aa0a96c2c3cc','06-kashtanka/7114c90d-6b2a-48f2-8c3b-163c74963764','07-kashtanka/3ed8d542-fe7b-46e9-839f-bab0350c7c37','03-kashtanka/148fee7f-a0eb-486c-874b-9a8363798309']
 : ['01-jekyll/e0895f55-ded4-4e7f-8ddf-e19126f66f8f','01-jekyll/68b8cde7-afbb-4a50-83ab-87e1088928dc','02-jekyll/baa94383-d12f-4e7c-8aea-c0c461a65480','02-jekyll/b09e8ce4-447d-4c4d-8531-505f38fc6e1d','03-jekyll/bdd00fbc-5c8f-4612-8e04-3268af4f0486'];
 const book={...source.book,chapters:source.book.chapters.map(c=>({...c,scenes:c.scenes.filter(s=>selected.includes(c.slug+'/'+s.id))})).filter(c=>c.scenes.length).map(c=>({...c,text:c.scenes.map(s=>s.text).join('\n\n')}))};
 const mutationSubset=mutations.filter(m=>selected.includes(m.chapter+'/'+m.scene));
 // После вставок координаты защищённых фрагментов берём по их буквальному тексту.
 const preserve=spans.filter(s=>selected.includes(s.chapter+'/'+s.scene)).map(s=>{const scene=book.chapters.find(c=>c.slug===s.chapter).scenes.find(x=>x.id===s.scene);const start=scene.text.indexOf(s.text);if(start<0)throw Error('preserve missing');return {...s,start,end:start+s.text.length};});
 sets.push({work,source:{...source,book},fixture,mutations:mutationSubset,preserve,pack:await loadPack(fixture.language)});
}
await writeFile(new URL('corpus.json',out),JSON.stringify(sets.map(s=>({work:s.work,book:s.source.book,mutations:s.mutations,preserve:s.preserve,control:s.fixture.control_chapter,sha256:sha256(JSON.stringify(s.source.book))})),null,2));
const jobs=models.flatMap(model=>[0,1].flatMap(repeat=>sets.map(set=>({model,repeat,set}))));
const results=[];
async function job({model,repeat,set}){
 const stem=model.replaceAll('/','-')+'-'+set.work+'-'+repeat;
 try{
  const old=JSON.parse(await readFile(new URL(stem+'.json',out),'utf8'));
  results.push(old);return;
 }catch(e){if(e.code!=='ENOENT')throw e;}
 const meta=metadata.find(m=>m.id===model);
 const config=configSchema.parse({providers:{experiment:{transport:'openai',endpoint:'https://openrouter.ai/api/v1/chat/completions',api_key:secret,family:model.split('/')[0],price:{input_per_m:Number(meta.pricing.prompt)*1e6,output_per_m:Number(meta.pricing.completion)*1e6,currency:'USD'}}},profiles:{edit:{provider:'experiment',model,temperature:0,reasoning:true,context_budget:2048}},preserve:[]});
 const loaded={config,winningLayer:{},warnings:[]};
 const start=Date.now();
 const pass=await modelPass(set.source,loaded,set.pack,'copy',stem,[],true);
 const safe=[],rejected=[];
 for(const p of pass.proposals){
  const scene=set.source.book.chapters.find(c=>c.slug===p.location.chapter).scenes.find(s=>s.id===p.location.scene);
  const found=locate(scene.text,p.target);
  if(!('ok' in found)){rejected.push({id:p.id,reason:'stale'});continue;}
  const trap=semanticTrap(p.target.text,p.replacement,set.pack.pack,{category:p.category,inDialogue:inDialogue(dialogueSpans(scene.text,set.pack.pack),found.start,found.end),modelGenerated:true});
  const voice=voiceGuard(p,scene.text,set.source.book,set.pack.pack,config);
  if(trap||voice)rejected.push({id:p.id,reason:trap||voice});else safe.push(p);
 }
 const score=ps=>scoreProposals(set.source.book,ps,set.mutations,set.fixture.control_chapter,set.preserve);
 const result={model,reasoning_effort:'medium',repeat,work:set.work,mode:'copy',scope:'production editor pass plus deterministic guards; independent model verifier NOT run',prompt_version:pass.stage.prompt_version,elapsed_ms:Date.now()-start,stage:pass.stage,ledger:pass.ledger,proposals:pass.proposals,safe_proposals:safe,rejected,raw_score:score(pass.proposals),safe_score:score(safe)};
 await writeFile(new URL(stem+'.json',out),JSON.stringify(result,null,2));
 results.push(result);
 console.log(JSON.stringify({done:results.length,total:jobs.length,model,repeat,work:set.work,candidates:pass.proposals.length,safe:safe.length,recall:result.raw_score.matched.length,mutations:set.mutations.length,failures:pass.stage.failures,spent:spent.toFixed(4)}));
}
let cursor=0;
await Promise.all([0,1].map(async()=>{while(cursor<jobs.length)await job(jobs[cursor++]);}));
await writeFile(new URL('results.json',out),JSON.stringify({generated_at:new Date().toISOString(),cap_usd:cap,actual_cost_usd:spent,calls,results},null,2));
console.log(JSON.stringify({finished:true,spent,calls,out:out.pathname}));
