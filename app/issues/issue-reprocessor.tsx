"use client";

import {useEffect,useRef,useState} from "react";
import {isRecordOperationTerminal,recordOperationNeedsAttention} from "@/lib/record-operation";
import type {IssueReprocessTarget} from "@/lib/issues";
import type {SourceRecord} from "@/lib/workbench-types";

const STORAGE_KEY="mapeig:issue-reprocessing:v1";
const MAX_WAIT_MS=20*60_000;
type Campaign={startedAt:string;accepted:Record<string,string>;done:string[];errors:Record<string,string>};
class ActiveTaskError extends Error {}
const emptyCampaign=():Campaign=>({startedAt:new Date().toISOString(),accepted:{},done:[],errors:{}});

export function IssueReprocessor({targets,blocked,unavailable}:{targets:IssueReprocessTarget[];blocked:number;unavailable:boolean}){
 const [campaign,setCampaign]=useState<Campaign|null>(null);
 const [running,setRunning]=useState(false);
 const [stopping,setStopping]=useState(false);
 const current=useRef<Campaign|null>(null);
 const stop=useRef(false);
 useEffect(()=>{
  let timer:number|undefined;
  let cancelled=false;
  try{
   const stored=JSON.parse(localStorage.getItem(STORAGE_KEY)??"null") as Campaign|null;
   if(stored&&Date.now()-Date.parse(stored.startedAt)<7*86_400_000){
    current.current=stored;timer=window.setTimeout(()=>setCampaign(stored),0);
    // Another tab or an operator may have finished these jobs while this tab was closed.
    void (async()=>{
     const ids=[...new Set([...Object.keys(stored.accepted).filter(id=>!stored.done.includes(id)),...Object.keys(stored.errors)])];
     const done=new Set(stored.done);
     const errors={...stored.errors};
     for(let i=0;i<ids.length;i+=3){
      if(cancelled)return;
      await Promise.all(ids.slice(i,i+3).map(async id=>{
       try{
        const response=await fetch(`/api/records/${id}`,{cache:"no-store",signal:AbortSignal.timeout(15_000)});
        if(!response.ok)return;
        const payload=await response.json() as {record?:SourceRecord};
        const record=payload.record;
        if(!record)return;
        const finishedSinceStart=record.operationProgress?.state==="finished"&&Boolean(record.operationProgress.finishedAt)&&Date.parse(record.operationProgress.finishedAt!)>=Date.parse(stored.startedAt);
        const acceptedJobFinished=record.currentJobId===stored.accepted[id]&&isRecordOperationTerminal("process",record);
        if(!recordOperationNeedsAttention(record)&&(finishedSinceStart||acceptedJobFinished)){
         done.add(id);delete errors[id];
        }else if(record.issueGroup==="source"&&errors[id]){
         errors[id]="La font continua sense document processable; revisa el cas abans de repetir-lo.";
        }
       }catch{/* Keep the checkpoint if current status cannot be verified. */}
      }));
     }
     if(!cancelled&&current.current===stored){
      const reconciled={...stored,done:[...done],errors};
      current.current=reconciled;setCampaign(reconciled);localStorage.setItem(STORAGE_KEY,JSON.stringify(reconciled));
     }
    })();
   }
  }catch{/* An invalid browser checkpoint never starts a remote operation. */}
  return ()=>{cancelled=true;if(timer!==undefined)window.clearTimeout(timer);};
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
   if(record.currentJobId===jobId&&recordOperationNeedsAttention(record))throw Error("El procés s'ha interromput o té un error tècnic; revisa el cas abans de repetir-lo.");
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
    const payload=await response.json() as {error?:string;code?:string;result?:{jobId?:string}};
    if(response.status===409&&payload.code==='ACTIVE_TASK')throw new ActiveTaskError(payload.error??'Ja hi ha un procés actiu per a aquest registre.');
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
  const deferred=new Map<string,number>();
  try{
   await Promise.all(Array.from({length:3},async()=>{
    while(!stop.current&&cursor<pending.length){
     const target=pending[cursor++];
     try{await runOne(target);}catch(error){
     if(error instanceof ActiveTaskError){
      const attempts=(deferred.get(target.id)??0)+1;
      if(attempts<=12){deferred.set(target.id,attempts);pending.push(target);if(cursor>=pending.length-1)await new Promise(resolve=>setTimeout(resolve,15_000));continue;}
     }
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
  {campaign&&<p role="status" className="mt-2 text-sm tabular-nums">Seguiment d&apos;aquest navegador: {accepted} iniciats · {done} finalitzats · {errors} requereixen comprovació. {running?"Processament en curs.":""} Les operacions iniciades fora d&apos;aquest navegador no es compten aquí.</p>}
  <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={running||unavailable||pending===0} onClick={()=>void start()} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{campaign?"Continuar el reprocessament":"Reprocessar els casos disponibles"}</button>{running&&<button type="button" disabled={stopping} onClick={()=>{stop.current=true;setStopping(true);}} className="rounded-md border px-4 py-2 text-sm">{stopping?"Aturant…":"Aturar després dels casos en curs"}</button>}</div>
  {errors>0&&<div className="mt-3 text-xs"><p>Els casos amb error no s&apos;han repetit automàticament. Revisa l&apos;estat individual abans de tornar-los a iniciar.</p><ul className="mt-2 list-inside list-disc space-y-1">{failedTargets.slice(0,10).map(target=><li key={target.id}><a className="underline" href={`/records/${target.id}?from=%2Fissues`}>Obrir el cas {target.id.slice(0,8)}</a>: {campaign?.errors[target.id]}</li>)}</ul>{failedTargets.length>10&&<p className="mt-1">{failedTargets.length-10} casos més requereixen comprovació.</p>}</div>}
 </section>;
}
