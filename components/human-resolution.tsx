'use client';
import {useState} from 'react';
import type {SourceRecord} from '@/lib/workbench-types';
import {canResolveManually,currentReservation} from '@/lib/human-resolution';
import {DocumentViewer} from './document-viewer';

type Props={record:SourceRecord;services:Array<{code:string;name:string}>;onSaved:(record:SourceRecord)=>void};
const fields={service_code:'Codi de servei de la Cartera',final_service:'Servei prestat',final_population:'Persones destinatàries',financed_object:'Objecte finançat',provider_name:'Nom de l’entitat',provider_nif:'NIF de l’entitat'};
async function save(record:SourceRecord,body:Record<string,unknown>){
 const response=await fetch(`/api/records/${record.id}/resolution`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,expectedJobId:record.currentJobId})});
 const payload=await response.json();if(!response.ok)throw Error(payload.error??'No s’ha pogut guardar');
 window.dispatchEvent(new Event('navigation-counts:refresh'));return payload.record as SourceRecord;
}
export function DocumentedCorrectionForm({record,services,onSaved,unitId,documentId,initialPage=1}:{unitId?:string;documentId?:string;initialPage?:number}&Props){
 const [open,setOpen]=useState(false);
 const [field,setField]=useState<keyof typeof fields>('service_code'),[value,setValue]=useState(''),[selected,setSelected]=useState(documentId??''),[page,setPage]=useState(initialPage),[evidence,setEvidence]=useState(''),[visual,setVisual]=useState(false),[reason,setReason]=useState(''),[reviewer,setReviewer]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const documents=record.sourceDocuments.filter(d=>d.archived&&d.status==='fetched'&&(!documentId||d.id===documentId));
 const document=documents.find(d=>d.id===selected)??documents[0];
 const previous=record.corrections?.find(c=>c.unit_id===(unitId??null)&&c.field===field);
 const editable=canResolveManually(record)&&!currentReservation(record);
 return <details onToggle={e=>setOpen(e.currentTarget.open)} id={unitId?`correction-${unitId}`:'completar-dades'} className="rounded-lg border p-4 scroll-mt-32"><summary className="cursor-pointer font-semibold">{unitId?'Completar aquesta línia amb evidència':'Completar dades amb evidència documental'}</summary>{open&&<>
 <p className="mt-2 text-sm">Conserva el valor original i registra una correcció humana. No aprova el cas. Un codi agrupador només és admissible en concerts quan sigui el nivell acreditat.</p>
 {document?.mimeType?.includes('pdf')&&<div className="mt-3"><DocumentViewer url={`/api/documents/${document.id}/open`} page={page}/></div>}
 <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={async event=>{event.preventDefault();if(!document||!editable)return;setBusy(true);setError('');try{const updated=await save(record,{action:'correct',requestId:crypto.randomUUID(),expectedRevision:previous?.id??null,unitId:unitId??null,field,value,documentId:document.id,documentRevision:document.revision,page,evidence,visualCheck:visual,reason,reviewer});onSaved(updated);setMessage('Correcció desada. Revisa la cobertura i valida el conjunt quan sigui complet.');}catch(cause){setError(cause instanceof Error?cause.message:'Error en desar');}finally{setBusy(false);}}}>
 <label className="text-sm">Camp<select className="form-control block w-full" value={field} onChange={e=>{setField(e.target.value as keyof typeof fields);setValue('');}}>{Object.entries(fields).filter(([key])=>!unitId||['service_code','provider_name'].includes(key)).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
 <label className="text-sm">Valor acreditat{field==='service_code'?<><input className="form-text block w-full" required value={value} onChange={e=>setValue(e.target.value)} list={`services-${unitId??record.id}`}/><datalist id={`services-${unitId??record.id}`}>{services.map(s=><option key={s.code} value={s.code}>{s.name}</option>)}</datalist></>:<input className="form-text block w-full" value={value} onChange={e=>setValue(e.target.value)} required maxLength={2000}/>}</label>
 <label className="text-sm">Document arxivat<select className="form-control block w-full" value={document?.id??''} onChange={e=>setSelected(e.target.value)} required><option value="" disabled>Selecciona una font</option>{documents.map((d,i)=><option key={d.id} value={d.id}>Document {i+1} · {d.id.slice(0,8)}</option>)}</select></label>
 <label className="text-sm">Pàgina<input className="form-text block w-full" type="number" min={1} max={2000} value={page} onChange={e=>setPage(Number(e.target.value))} required/></label>
 <label className="text-sm sm:col-span-2">Cita o descripció precisa de la comprovació visual<textarea className="form-text block w-full" value={evidence} onChange={e=>setEvidence(e.target.value)} minLength={12} maxLength={4000} required/></label>
 <label className="flex gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={visual} onChange={e=>setVisual(e.target.checked)}/>He comprovat visualment el PDF. La lectura automàtica no permet verificar literalment aquesta cita.</label>
 <label className="text-sm">Motiu de la correcció<textarea className="form-text block w-full" value={reason} onChange={e=>setReason(e.target.value)} minLength={10} maxLength={2000} required/></label>
 <label className="text-sm">Persona revisora · nom declarat<input className="form-text block w-full" value={reviewer} onChange={e=>setReviewer(e.target.value)} minLength={3} maxLength={120} required/></label>
 {previous&&<p className="text-sm sm:col-span-2">Correcció anterior: {previous.value} · {previous.valid?'font vigent':'font canviada; pendent de revisar'}. La nova correcció conservarà l’anterior.</p>}
 <button disabled={busy||!document||!editable} className="rounded-md border px-4 py-2 text-sm font-semibold disabled:opacity-50">{busy?'Desant…':'Desar correcció documentada'}</button>
 {!editable&&<p className="text-sm">Cal un intent finalitzat pendent de revisió. Si hi ha una reserva, reobre-la primer.</p>}
 </form>{error&&<p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}{message&&<p role="status" className="mt-3 text-sm">{message}</p>}</>}</details>;
}
export function HumanResolution({record,services,onSaved}:Props){
 const [reason,setReason]=useState(''),[missing,setMissing]=useState(''),[reviewer,setReviewer]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const reservation=currentReservation(record),editable=canResolveManually(record);
 return <section id="resolucio-humana" className="surface space-y-4 p-5"><h2 className="section-title">Què falta per resoldre aquest cas?</h2><p className="text-sm">Completa els fets acreditats o registra una acceptació provisional. La decisió humana i l’anàlisi automàtica es conserven per separat.</p>
 {!!record.corrections?.length&&<ul className="space-y-2 text-sm">{record.corrections.map(c=><li key={c.id}><strong>{fields[c.field as keyof typeof fields]??c.field}: {c.value}</strong>{c.unit_id?' · Correcció d’una línia':''} · {c.valid?'Font vigent':'Font canviada: cal revisar de nou'} · pàgina {c.page} · {c.reviewer} (nom declarat)<p>{c.reason}</p><a className="underline" href={`/api/documents/${c.document_id}/open#page=${c.page}`} target="_blank" rel="noreferrer">Comprovar la font</a></li>)}</ul>}
 {!record.isHistorical&&<DocumentedCorrectionForm record={record} services={services} onSaved={onSaved}/>}
 {reservation&&<div className="status-warning rounded-lg border p-4"><strong>Acceptat amb reserves · fora dels totals definitius</strong><p>{reservation.reason}</p><p>Mancances: {reservation.missing_items}</p><p className="text-xs">{reservation.reviewer} · nom declarat, no identitat autenticada</p></div>}
 {(editable||reservation)&&<details className="rounded-lg border p-4"><summary className="cursor-pointer font-semibold">{reservation?'Reobrir el cas':'Acceptar amb reserves'}</summary><p className="mt-2 text-sm">{reservation?'Torna a la revisió pendent i conserva la reserva a l’historial.':'No acredita la correspondència ni aprova finançament. El cas es consultarà a Resultats → Amb reserves, exclòs dels totals definitius. No substitueix provisions ja aprovades.'}</p>
 <form className="mt-3 grid gap-3" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{onSaved(await save(record,{action:reservation?'reopen':'accept',requestId:crypto.randomUUID(),expectedRevision:record.reservation?.id??null,reason,missingItems:missing,reviewer}));}catch(cause){setError(cause instanceof Error?cause.message:'No s’ha pogut desar');}finally{setBusy(false);}}}>
 <label className="text-sm">Motiu<textarea required minLength={10} maxLength={2000} className="form-text block w-full" value={reason} onChange={e=>setReason(e.target.value)}/></label>
 {!reservation&&<label className="text-sm">Què queda sense acreditar?<textarea required minLength={10} maxLength={2000} className="form-text block w-full" value={missing} onChange={e=>setMissing(e.target.value)}/></label>}
 <label className="text-sm">Persona revisora · nom declarat<input required minLength={3} maxLength={120} className="form-text block w-full" value={reviewer} onChange={e=>setReviewer(e.target.value)}/></label>
 <button disabled={busy} className="justify-self-start rounded-md border px-4 py-2 text-sm font-semibold disabled:opacity-50">{busy?'Desant…':reservation?'Reobrir i revisar':'Desar acceptació amb reserves'}</button>
 </form>{error&&<p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}</details>}
 </section>;
}
