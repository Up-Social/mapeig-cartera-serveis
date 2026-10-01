"use client";
import {useEffect,useState} from 'react';
import type {SourceRecord} from '@/lib/workbench-types';
import {sourceDocumentTypeLabel} from '@/lib/ui-labels';
type Unit={id:string;provider_name:string;centre:string|null;period:string;service_code:string;amount:number|null;status:string;evidence_quote:string;review_note:string|null;page:number;act_type:string};
export function ConcertUnits({record,services}:{record:SourceRecord;services:Array<{code:string;name:string}>}) {
 const [supported,setSupported]=useState(true);
 const [units,setUnits]=useState<Unit[]>([]);const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [notes,setNotes]=useState<Record<string,string>>({});
 const url=`/api/records/${record.id}/units`;
 useEffect(()=>{const c=new AbortController();fetch(url,{signal:c.signal}).then(r=>r.json()).then(data=>{if(data.error)setError(data.error);else {setSupported(data.supported!==false);setUnits(data.units??[]);}}).catch(e=>{if(e.name!=='AbortError')setError('No s’han pogut carregar les unitats');});return ()=>c.abort();},[url]);
 async function submit(body:Record<string,unknown>) {
  setBusy(true);setError('');try{
   const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,expectedJobId:record.currentJobId}),signal:AbortSignal.timeout(20000)});
   const data=await r.json();if(!r.ok)throw Error(data.error);
   const current=await fetch(url,{signal:AbortSignal.timeout(15000)}).then(r=>r.json());if(current.error)throw Error(current.error);setUnits(current.units);
  }catch(e){setError(e instanceof Error?e.message:'No s’ha pogut guardar');}finally{setBusy(false);}
 }
 if(!supported)return <section id="unitats" className="surface p-5"><h2 className="section-title">Unitats del concert</h2><p className="mt-2 text-sm leading-6">El desglossament per entitats està pendent d’activació en aquesta base de dades. Es conserva la provisió actual del registre.</p></section>;
 const allowed=!record.isHistorical&&['approved','corrected'].includes(record.currentJobStatus??'');
 return <section id="unitats" className="surface space-y-4 p-5"><h2 className="section-title">Unitats del concert · detall de l’annex</h2><p className="text-sm leading-6">Cada fila representa una entitat, centre, servei i període. Copia la fila acreditada de l’annex i valida cada unitat. El codi explícit es contrasta amb la Cartera; no cal una nova crida a la IA. Deixa l’import buit si el document només indica un total global. Les pròrrogues, modificacions i extincions es registren amb el seu tipus d’acte.</p>
 {units.map(unit=><article key={unit.id} className="rounded border p-4 space-y-2"><h3 className="font-semibold">{unit.provider_name} · {unit.service_code} · {unit.period}</h3><p>{unit.centre??'Centre no informat'} · {unit.act_type} · {unit.amount==null?'Import individual no acreditat':`${unit.amount} €`} · {unit.status==='approved'?'Aprovada':unit.status==='rejected'?'Rebutjada':'Pendent de revisió'}</p><blockquote className="whitespace-pre-wrap border-l pl-3">Pàgina {unit.page}: {unit.evidence_quote}</blockquote>{unit.review_note&&<p>Revisió: {unit.review_note}</p>}{allowed&&unit.status==='draft'&&<div className="space-y-2"><label className="block">Justificació de la unitat<textarea className="form-text w-full" value={notes[unit.id]??''} onChange={e=>setNotes({...notes,[unit.id]:e.target.value})}/></label><button disabled={busy||(notes[unit.id]?.trim().length??0)<10} className="rounded border px-3 py-2 disabled:opacity-50" onClick={()=>void submit({unitId:unit.id,approve:true,note:notes[unit.id]})}>Aprovar unitat</button><button disabled={busy||(notes[unit.id]?.trim().length??0)<10} className="ml-2 rounded border px-3 py-2 disabled:opacity-50" onClick={()=>void submit({unitId:unit.id,approve:false,note:notes[unit.id]})}>Rebutjar unitat</button></div>}</article>)}
 {units.some(u=>u.status==='approved')&&<p role="status" className="text-sm">L’Excel exporta les unitats aprovades. La provisió global anterior es conserva a l’historial i queda exclosa per evitar duplicar imports. Revisa totes les files de l’annex abans d’exportar.</p>}
 {allowed?<form className="grid gap-3 md:grid-cols-2" onSubmit={e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.currentTarget));void submit({unit:data});}}>
 {([['provider_name','Entitat beneficiària',true],['provider_nif','NIF',false],['centre','Centre',false],['period','Període acreditat',true]] as const).map(([name,label,required])=><label key={name}>{label}<input className="form-text mt-1 w-full" name={name} required={required} maxLength={300}/></label>)}
 <label>Servei de Cartera<select className="form-control mt-1 w-full" name="service_code" required><option value="">Selecciona el codi de l’annex</option>{services.map(s=><option key={s.code} value={s.code}>{s.code} · {s.name}</option>)}</select></label>
 <label>Tipus d’acte<select className="form-control mt-1 w-full" name="act_type"><option value="award">Adjudicació / concert</option><option value="renewal">Pròrroga</option><option value="amendment">Modificació</option><option value="termination">Extinció</option></select></label>
 <label>Import individual acreditat (€)<input className="form-text mt-1 w-full" type="number" step="0.01" name="amount"/></label>
 <label>Document<select className="form-control mt-1 w-full" name="document_id" required><option value="">Selecciona el document</option>{record.sourceDocuments.filter(d=>d.status==='fetched').map(d=><option key={d.id} value={d.id}>{sourceDocumentTypeLabel(d.documentType)} · {d.url}</option>)}</select></label>
 <label>Pàgina de l’annex<input className="form-text mt-1 w-full" type="number" name="page" min="1" required/></label>
 <label className="md:col-span-2">Cita literal de la fila i del codi de servei<textarea className="form-text mt-1 min-h-28 w-full" name="evidence_quote" minLength={20} maxLength={12000} required/></label>
 <button disabled={busy} className="rounded border px-3 py-2 disabled:opacity-50">{busy?'Guardant…':'Afegir unitat pendent de revisió'}</button></form>:<p className="text-sm">Valida primer el resultat del registre vigent per poder desglossar les transaccions acreditades.</p>}
 {error&&<p role="alert" className="status-error p-3">{error}</p>}
 </section>;
}
