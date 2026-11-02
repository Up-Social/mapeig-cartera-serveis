'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {SourceDocument} from '@/lib/workbench-types';

type Observation={event_id:string;document_id:string;page:number;role:string;quote:string;declared_reviewer:string;rationale:string;created_at:string;source_sha256:string;source_version:string};

/** Optional preparation only; not a decision, approval, or proof of identity. */
export function ConveniVisualReview({recordId,documents,coverageAvailable=false}:{recordId:string;documents:SourceDocument[];coverageAvailable?:boolean}){
 const available=documents.filter(d=>['agreement','annex'].includes(d.documentType)&&d.status==='fetched'&&d.mimeType==='application/pdf');
 const [documentId,setDocumentId]=useState(''),[url,setUrl]=useState(''),[readId,setReadId]=useState(''),[page,setPage]=useState('1');
 const [role,setRole]=useState('economic'),[quote,setQuote]=useState(''),[reviewer,setReviewer]=useState(''),[rationale,setRationale]=useState(''),[confirmed,setConfirmed]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const pending=useRef<{key:string;eventId:string}|null>(null);
 const [history,setHistory]=useState<Observation[]>([]),[historyError,setHistoryError]=useState('');
 const loadHistory=useCallback(async()=>{try{const r=await fetch(`/api/records/${recordId}/conveni/visual`,{cache:'no-store'});const data=await r.json();if(!r.ok||!Array.isArray(data.observations))throw Error();setHistory(data.observations);setHistoryError('');}catch{setHistoryError('No s’ha pogut carregar l’historial visual.');}},[recordId]);
 useEffect(()=>{let active=true;queueMicrotask(()=>{if(active)void loadHistory();});return()=>{active=false;};},[loadHistory]);
 useEffect(()=>()=>{if(url)URL.revokeObjectURL(url);},[url]);
 async function open(){
  if(!documentId)return;setBusy(true);setError('');setMessage('');setReadId('');setUrl('');setConfirmed(false);
  const eventId=crypto.randomUUID();
  try{const r=await fetch(`/api/records/${recordId}/conveni/visual`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'open',eventId,documentId})});
   if(!r.ok){const e=await r.json();throw Error(e.error??'Font no disponible');}
   const blob=await r.blob();setUrl(URL.createObjectURL(blob));setReadId(eventId);
  }catch(e){setError(e instanceof Error?e.message:'No s’ha pogut obrir la font');}finally{setBusy(false);}
 }
 async function save(){
  if(!readId||!confirmed)return;setBusy(true);setError('');setMessage('');
  const payload={action:'assert',readId,documentId,page:Number(page),role,quote,reviewer,rationale,confirmed};const key=JSON.stringify(payload);
  if(pending.current?.key!==key)pending.current={key,eventId:crypto.randomUUID()};
  try{const r=await fetch(`/api/records/${recordId}/conveni/visual`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,eventId:pending.current.eventId})});
   const data=await r.json();if(!r.ok)throw Error(data.error);pending.current=null;setMessage('Observació desada. No s’ha aprovat ni atribuït cap import.');setConfirmed(false);await loadHistory();
  }catch(e){setError(e instanceof Error?e.message:'No s’ha pogut desar');}finally{setBusy(false);}
 }
 return <section className="space-y-3 rounded border p-4"><h3 className="font-semibold">Preparar una observació visual</h3>
  <p className="text-sm">Obre una versió verificada i contrasta la cita amb el document. La declaració no aprova el conveni ni certifica la identitat de qui revisa. Encara no s’incorpora al borrador ni a cap decisió econòmica.</p>
  <label className="block text-sm">Document PDF<select className="form-control mt-1 w-full" value={documentId} disabled={busy} onChange={e=>{setDocumentId(e.target.value);setUrl('');setReadId('');setConfirmed(false);}}><option value="">Selecciona un document</option>{available.map(d=><option key={d.id} value={d.id}>{d.documentType} · {d.url}</option>)}</select></label>
  <button type="button" className="rounded border px-3 py-2" disabled={!documentId||busy} onClick={()=>void open()}>Obreix la versió verificada</button>
  {url&&<><iframe title="Document PDF verificat" sandbox="" src={url} className="h-96 w-full rounded border"/><a href={url} download="document-verificat.pdf" className="inline-block underline">Descarrega el PDF verificat</a><p className="text-sm">Es registra la referència de la versió oberta, però no es garanteix conservar-ne els bytes. Si la font canvia, caldrà obrir-la de nou. Les observacions s’eliminen si s’elimina el document.</p>
   <label className="block text-sm">Pàgina<input className="form-text mt-1 w-full" type="number" min="1" max="10000" value={page} onChange={e=>setPage(e.target.value)}/></label>
   <label className="block text-sm">Què acredita la cita<select className="form-control mt-1 w-full" value={role} onChange={e=>setRole(e.target.value)}><option value="economic">Import</option><option value="identity">Identitat</option><option value="role_period">Receptor i període</option><option value="social">Naturalesa social</option>{coverageAvailable&&<option value="coverage">Revisió del document o annex</option>}</select></label>
   <label className="block text-sm">Cita transcrita<textarea className="form-text mt-1 w-full" value={quote} onChange={e=>setQuote(e.target.value)} maxLength={4000}/></label>
   <label className="block text-sm">Nom declarat de qui revisa<input className="form-text mt-1 w-full" value={reviewer} onChange={e=>setReviewer(e.target.value)} maxLength={120}/></label>
   <label className="block text-sm">Justificació<textarea className="form-text mt-1 w-full" value={rationale} onChange={e=>setRationale(e.target.value)} maxLength={2000}/></label>
   <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>Confirmo que he contrastat la cita i la pàgina amb el document obert.</span></label>
   <button type="button" className="rounded border px-3 py-2" disabled={busy||!confirmed||quote.trim().length<12||reviewer.trim().length<3||rationale.trim().length<10||!Number.isInteger(Number(page))||Number(page)<1||Number(page)>10000} onClick={()=>void save()}>Desa l’observació</button>
  </>}
  <details><summary className="cursor-pointer font-semibold">Historial d’observacions visuals</summary><p className="mt-2 text-sm">Darreres 100 observacions. Són declaracions històriques; la font i la seva vigència s’han de tornar a contrastar.</p>{historyError&&<p role="alert">{historyError}</p>}<ul className="mt-2 space-y-3">{history.map(item=><li key={item.event_id} className="rounded border p-2 text-sm"><p>{item.role} · pàgina {item.page} · {item.declared_reviewer}</p><p>{item.quote}</p><p>{item.rationale}</p><p className="break-all text-xs">Document {item.document_id} · SHA-256 {item.source_sha256} · versió {item.source_version}</p></li>)}</ul></details>
  {error&&<p role="alert" className="status-error rounded p-2">{error}</p>}{message&&<p role="status" className="status-success rounded p-2">{message}</p>}
 </section>;
}
