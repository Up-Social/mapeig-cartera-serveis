'use client';
import {useEffect,useRef,useState} from 'react';
import {ConcertPopulationObservation} from './concert-population-observation';

type Props={recordId:string;unitId:string;jobId:string;serviceCode:string|null;quote:string|null;status:string;page:number|null;onSaved:()=>void};
type Availability='loading'|'unavailable'|'paused'|'error'|'ready';
/** Do not interpret a malformed response or an HTTP failure as a disabled feature. */
export async function readAwardAvailability(response:Response):Promise<{enabled:boolean;previousId:string|null;paused?:true;reason?:string|null}>{
 if(!response.ok)throw Error('AVAILABILITY_UNAVAILABLE');
 const data:unknown=await response.json();
 if(!data||typeof data!=='object'||Array.isArray(data)||typeof (data as {enabled?:unknown}).enabled!=='boolean')throw Error('AVAILABILITY_INVALID');
 const value=data as {enabled:boolean;previousId?:unknown;paused?:unknown;reason?:unknown};
 if(value.paused!==undefined&&value.paused!==true)throw Error('AVAILABILITY_INVALID');
 if(value.paused===true){if(value.enabled||(value.reason!=null&&typeof value.reason!=='string'))throw Error('AVAILABILITY_INVALID');return {enabled:false,previousId:null,paused:true,reason:typeof value.reason==='string'?value.reason.slice(0,240):null};}
 if(value.enabled&&(!('previousId' in value)||(value.previousId!==null&&typeof value.previousId!=='string')))throw Error('AVAILABILITY_INVALID');
 return {enabled:value.enabled,previousId:value.enabled&&typeof value.previousId==='string'?value.previousId:null};
}
export function ConcertAwardAvailability({state,onRetry,reason}:{state:Exclude<Availability,'ready'>;onRetry:()=>void;reason?:string|null}){
 if(state==='loading')return <p className="mt-3 text-sm" role="status">Comprovant si la revisió econòmica individual està disponible…</p>;
 if(state==='paused')return <p className="mt-3 rounded border p-3 text-sm" role="status">Les revisions econòmiques de Concerts estan temporalment aturades.{reason&&<> Motiu: {reason}</>} Les dades i les decisions anteriors continuen disponibles per consultar-les.</p>;
 if(state==='unavailable')return <p className="mt-3 rounded border p-3 text-sm" role="status">La revisió econòmica individual encara no està disponible: cal verificar conjuntament les còpies documentals, les decisions i les exportacions d’aquest circuit. La situació i les dades de la línia es conserven.</p>;
 return <div className="mt-3 rounded border p-3 text-sm" role="alert"><p>No s’ha pogut comprovar si la revisió econòmica individual està disponible. Torna-ho a provar.</p><button type="button" className="mt-2 rounded border px-3 py-2" onClick={onRetry}>Torna a comprovar</button></div>;
}
/** One observation per approved line. An old line without an independent
 * predecessor remains read-only until the server confirms that it can reopen. */
export function ConcertApprovedPopulation({recordId,unitId,jobId,page,enabled,previousId}:{recordId:string;unitId:string;jobId:string;page:number|null;enabled:boolean|null;previousId:string|null}){
 if(enabled===null)return null;
 return <ConcertPopulationObservation recordId={recordId} unitId={unitId} jobId={jobId} page={page} editable={enabled&&!!previousId}/>;
}
export function ConcertLineAward({recordId,unitId,jobId,serviceCode,quote,status,page,onSaved}:Props){
 const [enabled,setEnabled]=useState<boolean|null>(null),[eventId,setEventId]=useState(''),[amount,setAmount]=useState(''),[citation,setCitation]=useState(quote??''),[reason,setReason]=useState(''),[reviewer,setReviewer]=useState('');
 const [availability,setAvailability]=useState<Availability>('loading'),[availabilityAttempt,setAvailabilityAttempt]=useState(0);
 const [pauseReason,setPauseReason]=useState<string|null>(null);
 const [previousId,setPreviousId]=useState<string|null>(null);
 const [award,setAward]=useState(false),[recipient,setRecipient]=useState(false),[allocation,setAllocation]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[uncertain,setUncertain]=useState(false);
 const attempt=useRef<{signature:string;id:string}|null>(null);const url=`/api/records/${recordId}/units/${unitId}/award`;
 useEffect(()=>{const c=new AbortController();fetch(`${url}?job=${encodeURIComponent(jobId)}`,{signal:AbortSignal.any([c.signal,AbortSignal.timeout(15000)]),cache:'no-store'}).then(readAwardAvailability).then(data=>{if(c.signal.aborted)return;setPreviousId(data.previousId);setEnabled(data.enabled);setPauseReason(data.reason??null);setAvailability(data.enabled?'ready':data.paused?'paused':'unavailable');}).catch(()=>{if(!c.signal.aborted){setEnabled(false);setAvailability('error');}});return()=>c.abort();},[url,jobId,availabilityAttempt]);
 useEffect(()=>{if(!enabled)return;const c=new AbortController();fetch(`/api/records/${recordId}/units/${unitId}/population?job=${encodeURIComponent(jobId)}`,{signal:c.signal,cache:'no-store'}).then(r=>{if(!r.ok)throw Error('POPULATION_UNAVAILABLE');return r.json();}).then(data=>{setEventId(data.snapshot?.event?.id??'');}).catch(()=>{if(!c.signal.aborted)setError('No s’ha pogut carregar l’observació de població.');});return()=>c.abort();},[enabled,recordId,unitId,jobId]);
 const population=status==='approved'?<ConcertApprovedPopulation recordId={recordId} unitId={unitId} jobId={jobId} page={page} enabled={enabled} previousId={previousId}/>:null;
 if(availability!=='ready')return <>{population}<ConcertAwardAvailability state={availability} reason={pauseReason} onRetry={()=>{setAvailability('loading');setAvailabilityAttempt(value=>value+1);}}/></>;
 if(!enabled)return population;
 if(status==='approved'&&!previousId)return <>{population}<p className="mt-3 rounded border p-3 text-sm" role="status">Aquesta línia aprovada no té una decisió individual anterior disponible. La revisió econòmica individual queda pendent de comprovació.</p></>;
 async function refreshPopulation(){try{const response=await fetch(`/api/records/${recordId}/units/${unitId}/population?job=${encodeURIComponent(jobId)}`,{cache:'no-store',signal:AbortSignal.timeout(15000)});const body=await response.json();if(!response.ok)throw Error(body.error);setEventId(body.snapshot?.event?.id??'');setError('');}catch{setError('No s’ha pogut carregar l’observació de població.');}}
 async function exportLine(){if(!previousId||busy)return;setBusy(true);setError('');try{const response=await fetch('/api/exports/concert-lines',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[previousId]}),signal:AbortSignal.timeout(30000)});if(!response.ok){const body=await response.json();throw Error(body.error);}const bytes=await response.blob();const url=URL.createObjectURL(bytes);const link=document.createElement('a');link.href=url;link.download='linia-concert.xlsx';link.click();URL.revokeObjectURL(url);}catch(cause){setError(cause instanceof Error?cause.message:'No s’ha pogut exportar la línia.');}finally{setBusy(false);}}
 async function submit(){
  const payload={jobId,eventId,previousId,code:serviceCode,amountLiteral:amount,quote:citation,reason,reviewer,award,recipient,allocation};const signature=JSON.stringify(payload);
  if(attempt.current?.signature!==signature)attempt.current={signature,id:crypto.randomUUID()};
  if(uncertain)return;
  setBusy(true);setError('');try{
   const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,decisionId:attempt.current.id}),signal:AbortSignal.timeout(70000)});
   const body=await response.json();
   if(!response.ok){
    if(body.outcome==='unknown'||(response.status>=500&&body.outcome!=='not_sent'))setUncertain(true);
    setError(typeof body.error==='string'?body.error:'No s’ha pogut desar la revisió.');return;
   }
   attempt.current=null;onSaved();
  }catch{setUncertain(true);setError('No s’ha pogut confirmar el resultat de la revisió. Pot haver-se desat: torna a carregar la línia i comprova’n l’estat abans de repetir-la.');}finally{setBusy(false);}
 }
 return <>{population}<section className="mt-3 space-y-3 rounded border p-3 text-sm" aria-label="Revisió econòmica de la línia"><h5 className="font-semibold">{previousId?'Torna a revisar la línia':'Revisió econòmica de la línia'}</h5><p>Contrasta la resolució i la còpia de la línia. Si no s’ha trobat la població, pot quedar pendent. L’evolució necessita dades addicionals.</p>
 {previousId&&<button type="button" className="rounded border px-3 py-2 disabled:opacity-50" disabled={busy} onClick={()=>void exportLine()}>Exporta aquesta línia</button>}
 <p>{eventId?'Si acabes de modificar la població, actualitza-la abans de revisar la línia.':'Cal desar primer l’observació de població, encara que sigui pendent.'} <button type="button" className="underline" onClick={()=>void refreshPopulation()}>Actualitza l’observació</button></p>{error&&<p role="alert" className="status-warning rounded p-2">{error}</p>}
 <p>Codi del servei a revisar: {serviceCode??'pendent'}. Si deriva d’una correcció documental, contrasta també la seva font i justificació.</p>
 {!serviceCode&&<p className="status-warning rounded p-2" role="status">No s’ha identificat un codi de servei per a aquesta línia. Contrasta el document i registra el codi abans d’aprovar-la; la línia no es descarta per aquesta absència.</p>}
 <form className="space-y-2" onSubmit={event=>{event.preventDefault();void submit();}}>
 <label className="block">Import literal a la font<input className="form-text mt-1 w-full" value={amount} onChange={e=>setAmount(e.target.value)} required maxLength={64}/></label>
 <label className="block">Cita literal que identifica la línia, l’entitat i l’import; el servei pot estar acreditat també per una correcció documental vigent<textarea className="form-text mt-1 w-full" value={citation} onChange={e=>setCitation(e.target.value)} required maxLength={5000}/></label>
 <label className="block">Justificació<textarea className="form-text mt-1 w-full" value={reason} onChange={e=>setReason(e.target.value)} required minLength={10} maxLength={2000}/></label><label className="block">Nom declarat de la persona revisora<input className="form-text mt-1 w-full" value={reviewer} onChange={e=>setReviewer(e.target.value)} required minLength={3} maxLength={200}/></label>
 <label className="block"><input type="checkbox" checked={award} onChange={e=>setAward(e.target.checked)} required/> Confirmo que és una adjudicació definitiva.</label><label className="block"><input type="checkbox" checked={recipient} onChange={e=>setRecipient(e.target.checked)} required/> Confirmo la identitat de l’entitat receptora.</label><label className="block"><input type="checkbox" checked={allocation} onChange={e=>setAllocation(e.target.checked)} required/> Confirmo que l’import correspon a aquesta línia.</label>
 <button className="rounded border px-3 py-2 disabled:opacity-50" disabled={busy||uncertain||!eventId||!serviceCode}>{busy?'Verificant…':'Aprova la línia'}</button></form></section></>;
}
