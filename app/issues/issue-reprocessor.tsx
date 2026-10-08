"use client";

import {useEffect,useRef,useState} from "react";
import {isRecordOperationTerminal} from "@/lib/record-operation";
import type {IssueReprocessTarget} from "@/lib/issues";
import type {SourceRecord} from "@/lib/workbench-types";

const STORAGE_KEY="mapeig:issue-reprocessing:v1";
const MAX_WAIT_MS=20*60_000;
type Campaign={startedAt:string;accepted:Record<string,string>;done:string[];errors:Record<string,string>};
const emptyCampaign=():Campaign=>({startedAt:new Date().toISOString(),accepted:{},done:[],errors:{}});

export function IssueReprocessor({targets,blocked,unavailable}:{targets:IssueReprocessTarget[];blocked:number;unavailable:boolean}){
 const [campaign,setCampaign]=useState<Campaign|null>(null);
 const [running,setRunning]=useState(false);
 const [stopping,setStopping]=useState(false);
 const current=useRef<Campaign|null>(null);
 const stop=useRef(false);
 useEffect(()=>{
  let timer:number|undefined;
  try{
   const stored=JSON.parse(localStorage.getItem(STORAGE_KEY)??"null") as Campaign|null;
   if(stored&&Date.now()-Date.parse(stored.startedAt)<7*86_400_000){current.current=stored;timer=window.setTimeout(()=>setCampaign(stored),0);}
  }catch{/* An invalid browser checkpoint never starts a remote operation. */}
  return ()=>{if(timer!==undefined)window.clearTimeout(timer);};
 },[]);
 const save=(value:Campaign)=>{current.current=value;setCampaign(value);localStorage.setItem(STORAGE_KEY,JSON.stringify(value));};
 async function latestRecord(id:string){
  const response=await fetch(`/api/records/${id}`,{cache:"no-store",signal:AbortSignal.timeout(15_000)});
  if(!response.ok)throw Error("No s'ha pogut consultar l'estat; comprova el cas abans de repetir-lo.");
  const payload=await response.json() as {record?:SourceRecord};
  if(!payload.record)throw Error("El registre ja no està disponible; comprova'l abans de repetir-lo.");
  return payload.record;
 }
 async function waitForResult(id:string,jobId:string){
  const deadline=Date.now()+MAX_WAIT_MS;
  while(Date.now()<deadline){
   const record=await latestRecord(id);
   if(record.currentJobId&&record.currentJobId!==jobId)throw Error("Una altra execució ha substituït aquest treball; comprova el cas abans de repetir-lo.");
   if(record.currentJobId===jobId&&isRecordOperationTerminal("process",record))return;
   await new Promise(resolve=>setTimeout(resolve,8_000));
  }
  throw Error("El procés continua o ha trigat massa; comprova'l abans de repetir-lo.");
 }
 async function runOne(target:IssueReprocessTarget){
  const prior=current.current??emptyCampaign();
  let jobId=prior.accepted[target.id];
  if(!jobId){
   const record=await latestRecord(target.id);
   // A separate OCR test or a resumed paused task may have completed while
   // this browser campaign was offline. Count that work without duplicating it.
   if(record.operationProgress?.state==="finished"&&record.operationProgress.finishedAt&&Date.parse(record.operationProgress.finishedAt)>=Date.parse(prior.startedAt)){
    save({...current.current!,done:[...new Set([...current.current!.done,target.id])],errors:Object.fromEntries(Object.entries(current.current!.errors).filter(([id])=>id!==target.id))});
    return;
   }
   if((record.currentJobId??null)!==(target.expectedJobId??null)){
    if(!record.currentJobId)throw Error("El treball anterior ha canviat; comprova el cas abans de repetir-lo.");
    // The previous POST may have succeeded before its response was lost.
    jobId=record.currentJobId;
   }else{
    const response=await fetch(`/api/records/${target.id}/operation`,{
     method:"POST",headers:{"Content-Type":"application/json"},
     body:JSON.stringify({operation:"process",...(target.expectedJobId?{expectedJobId:target.expectedJobId}:{})}),
     signal:AbortSignal.timeout(25_000),
    });
    const payload=await response.json() as {error?:string;result?:{jobId?:string}};
    if(!response.ok||!payload.result?.jobId)throw Error(payload.error??"No s'ha pogut iniciar; comprova el cas abans de repetir-lo.");
    jobId=payload.result.jobId;
   }
   save({...current.current!,accepted:{...current.current!.accepted,[target.id]:jobId}});
  }
  await waitForResult(target.id,jobId);
  save({...current.current!,done:[...new Set([...current.current!.done,target.id])],errors:Object.fromEntries(Object.entries(current.current!.errors).filter(([id])=>id!==target.id))});
 }
 async function start(){
  if(running||!targets.length||unavailable)return;
  const existing=current.current;
  const pending=targets.filter(target=>!existing?.done.includes(target.id));
  if(!pending.length)return;
  if(!window.confirm(`Es reprocessaran fins a ${pending.length} casos, amb lectura de fonts i cost d'IA. Cap resultat s'aprovarà automàticament. Vols continuar?`))return;
  if(!existing)save(emptyCampaign());
  else save({...existing,errors:{}});
  stop.current=false;setStopping(false);setRunning(true);
  let cursor=0;
  try{
   await Promise.all(Array.from({length:3},async()=>{
    while(!stop.current&&cursor<pending.length){
     const target=pending[cursor++];
     try{await runOne(target);}catch(error){
     const message=error instanceof Error?error.message:"Cal comprovar el cas abans de repetir-lo.";
     save({...current.current!,errors:{...current.current!.errors,[target.id]:message}});
     if(error instanceof TypeError||error instanceof DOMException)stop.current=true;
     }
    }
   }));
  }finally{setRunning(false);setStopping(false);}
 }
 const done=targets.filter(target=>campaign?.done.includes(target.id)).length;
 const accepted=targets.filter(target=>!!campaign?.accepted[target.id]).length;
 const errors=targets.filter(target=>!!campaign?.errors[target.id]).length;
 const pending=targets.filter(target=>!campaign?.done.includes(target.id)).length;
 const failedTargets=targets.filter(target=>!!campaign?.errors[target.id]);
 return <section className="surface p-4" aria-labelledby="issue-reprocess-title">
  <h2 id="issue-reprocess-title" className="font-semibold">Tornar a processar les incidències</h2>
  <p className="mt-2 max-w-[85ch] text-sm leading-6">Cada cas torna a cercar els documents oficials, preparar-los, contrastar-los i proposar una correspondència. Es conserva l&apos;historial i cap resultat s&apos;aprova automàticament. Es processen fins a tres casos alhora per limitar la càrrega. El contrast i la correspondència poden tenir cost d&apos;IA.</p>
  <p className="mt-2 text-sm">{targets.length} casos disponibles{blocked?` · ${blocked} operacions interrompudes excloses fins a conciliar el diagnòstic`:""}.</p>
  {unavailable&&<p className="mt-2 text-sm">El processament no està disponible en aquest entorn. Obre la versió de producció per executar-lo.</p>}
  {campaign&&<p role="status" className="mt-2 text-sm tabular-nums">{accepted} iniciats · {done} finalitzats · {errors} requereixen comprovació. {running?"Processament en curs.":""}</p>}
  <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={running||unavailable||pending===0} onClick={()=>void start()} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{campaign?"Continuar el reprocessament":"Reprocessar els casos disponibles"}</button>{running&&<button type="button" disabled={stopping} onClick={()=>{stop.current=true;setStopping(true);}} className="rounded-md border px-4 py-2 text-sm">{stopping?"Aturant…":"Aturar després dels casos en curs"}</button>}</div>
  {errors>0&&<div className="mt-3 text-xs"><p>Els casos amb error no s&apos;han repetit automàticament. Revisa l&apos;estat individual abans de tornar-los a iniciar.</p><ul className="mt-2 list-inside list-disc space-y-1">{failedTargets.slice(0,10).map(target=><li key={target.id}><a className="underline" href={`/records/${target.id}?from=%2Fissues`}>Obrir el cas {target.id.slice(0,8)}</a>: {campaign?.errors[target.id]}</li>)}</ul>{failedTargets.length>10&&<p className="mt-1">{failedTargets.length-10} casos més requereixen comprovació.</p>}</div>}
 </section>;
}
