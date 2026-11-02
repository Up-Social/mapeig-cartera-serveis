'use client';
import {useEffect,useRef,useState} from 'react';

type Observation={id:string;decision:'confirmed'|'unknown';value:string|null;page:number|null;quote:string|null;reason:string;reviewer:string;matches_recorded_fingerprints:boolean};
type Snapshot={unit_id:string;job_id:string;document_id:string;revision:string;document_hash:string;unit_hash:string;event:Observation|null};

/** Records a human observation; does not approve the unit or update funding. */
export function ConcertPopulationObservation({recordId,unitId,jobId,page,editable}:{recordId:string;unitId:string;jobId:string;page:number|null;editable:boolean}){
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [decision,setDecision]=useState<'unknown'|'confirmed'>('unknown'),[value,setValue]=useState(''),[quote,setQuote]=useState(''),[reason,setReason]=useState(''),[reviewer,setReviewer]=useState('');
 const attempt=useRef<{signature:string;id:string}|null>(null);
 const url=`/api/records/${recordId}/units/${unitId}/population`;
 useEffect(()=>{const controller=new AbortController();fetch(`${url}?job=${encodeURIComponent(jobId)}`,{cache:'no-store',signal:controller.signal}).then(async response=>{
  const body=await response.json();if(!response.ok)throw Error(body.error);setSnapshot(body.snapshot);setError('');
 }).catch(cause=>{if(cause.name!=='AbortError')setError('No s’ha pogut carregar la revisió de població.');});return()=>controller.abort();},[url,jobId]);
 async function save(){
  if(!snapshot)return;
  const data={jobId,previousId:snapshot.event?.id??null,decision,value:decision==='confirmed'?value.trim():null,documentId:snapshot.document_id,revision:snapshot.revision,
   page:decision==='confirmed'?page:null,quote:decision==='confirmed'?quote.trim():null,reason,reviewer,documentHash:snapshot.document_hash,unitHash:snapshot.unit_hash};
  const signature=JSON.stringify(data);
  if(attempt.current?.signature!==signature)attempt.current={signature,id:crypto.randomUUID()};
  setBusy(true);setError('');
  try {
   const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...data,eventId:attempt.current.id}),signal:AbortSignal.timeout(30000)});
   const body=await response.json();if(!response.ok)throw Error(body.error??'No s’ha pogut desar la revisió.');
   const loaded=await fetch(`${url}?job=${encodeURIComponent(jobId)}`,{cache:'no-store',signal:AbortSignal.timeout(15000)});const next=await loaded.json();
   if(!loaded.ok)throw Error('La revisió s’ha enviat, però no s’ha pogut confirmar. Torna a intentar-ho sense canviar les dades.');
   setSnapshot(next.snapshot);attempt.current=null;setReason('');setQuote('');setValue('');
  }catch(cause){setError(cause instanceof Error?cause.message:'No s’ha pogut desar la revisió.');}finally{setBusy(false);}
 }
 return <section className="mt-3 space-y-3 rounded border p-3 text-sm" aria-label="Població de la línia">
  <h5 className="font-semibold">Població d’aquesta línia</h5>
  <p>Aquesta observació es registra per separat. No aprova la línia ni afegeix finançament. La població general de l’expedient no acredita la de cada línia.</p>
  <p>Si es completa o modifica la línia, les seves dades o la font, caldrà tornar a contrastar l’observació.</p>
  {!snapshot&&!error&&<p role="status">Carregant la revisió…</p>}{error&&<p role="alert" className="status-warning rounded p-2">{error}</p>}
  {snapshot?.event&&<div><p>{snapshot.event.decision==='unknown'?'Població pendent':'Població observada'}: {snapshot.event.value??'no identificada'} · {snapshot.event.reviewer}. {snapshot.event.matches_recorded_fingerprints?'Les dades registrades coincideixen amb les empremtes guardades; això no acredita la vigència ni els bytes de la font.':'La línia o la font han canviat; cal tornar a contrastar l’observació.'}</p><p>Justificació: {snapshot.event.reason}</p>{snapshot.event.quote&&<p>Cita indicada a la pàgina {snapshot.event.page}: {snapshot.event.quote}</p>}</div>}
  {snapshot&&!snapshot.event&&<p>No hi ha cap observació registrada per a aquesta línia.</p>}
  {snapshot&&!editable&&<p>La línia ja està revisada. La modificació posterior d’aquesta observació encara no està disponible.</p>}
  {snapshot&&editable&&<form className="space-y-2" onSubmit={event=>{event.preventDefault();void save();}}>
   <label className="block">Resultat del contrast<select className="form-control mt-1 w-full" value={decision} onChange={event=>setDecision(event.target.value as 'unknown'|'confirmed')}><option value="unknown">Població no identificada · pendent</option><option value="confirmed">Població indicada al document</option></select></label>
   {decision==='confirmed'&&<><label className="block">Població indicada<input className="form-text mt-1 w-full" value={value} onChange={event=>setValue(event.target.value)} required minLength={3} maxLength={1000}/></label><label className="block">Cita literal de la pàgina {page??'pendent'}<textarea className="form-text mt-1 w-full" value={quote} onChange={event=>setQuote(event.target.value)} required minLength={12} maxLength={1000}/></label><p>La cita ha d’incloure la identitat de la línia i el valor indicat; consulta la pàgina del document.</p></>}
   <label className="block">Justificació<textarea className="form-text mt-1 w-full" value={reason} onChange={event=>setReason(event.target.value)} required minLength={10} maxLength={2000}/></label>
   <label className="block">Nom declarat de la persona revisora<input className="form-text mt-1 w-full" value={reviewer} onChange={event=>setReviewer(event.target.value)} required minLength={3} maxLength={200}/></label>
   <button className="rounded border px-3 py-2 disabled:opacity-50" disabled={busy||(decision==='confirmed'&&!page)}>{busy?'Desant…':'Desa l’observació de població'}</button>
  </form>}
 </section>;
}
