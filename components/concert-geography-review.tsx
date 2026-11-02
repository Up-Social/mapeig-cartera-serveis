'use client';
import React,{useState} from 'react';
type Decision={id:string;proposal_id:number;decision:string;reviewer:string;rationale:string;created_at:string};
type Current={review_fingerprint:string;review_valid:boolean;id:number;review_id:string|null;decision:string|null;conflict:boolean;municipality:string;source_sha256:string;source_captured_at:string;source_quote:string};
type ReviewData={available:boolean;current:Current|null;capture:{source_text:string;source_text_sha256:string}|null;history:Decision[]};
const labels:Record<string,string>={confirmed:'Confirmada',rejected:'Rebutjada',revoked:'Revocada'};
export function ConcertGeographyReview({recordId,unitId}:{recordId:string;unitId:string}){
 const [data,setData]=useState<ReviewData|null>(null),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [reviewer,setReviewer]=useState(''),[rationale,setRationale]=useState(''),[checked,setChecked]=useState(false);
 const url=`/api/records/${recordId}/concert-geography?unit=${unitId}`;
 async function load(){setBusy(true);setError('');try{const r=await fetch(url,{cache:'no-store'}),d=await r.json();if(!r.ok)throw Error(d.error);setData(d);setChecked(false);setRationale('');setOpen(true);}catch(e){setError(e instanceof Error?e.message:'No s’ha pogut carregar');}finally{setBusy(false);}}
 async function save(decision:string){
  if(!data?.current)return;setBusy(true);setError('');
  try{const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({unitId,proposalId:data.current.id,eventId:crypto.randomUUID(),previousId:data.current.review_id,reviewFingerprint:data.current.review_fingerprint,decision,reviewer,rationale,checked})});const d=await r.json();if(!r.ok)throw Error(d.error);setChecked(false);setRationale('');await load();window.dispatchEvent(new Event('concert-geography-saved'));}catch(e){setError(e instanceof Error?e.message:'No s’ha pogut desar');}finally{setBusy(false);}
 }
 const ready=!busy&&checked&&reviewer.trim().length>=2&&rationale.trim().length>=20;
 return <div className="mt-2 text-xs"><button type="button" className="underline" disabled={busy} onClick={()=>void load()}>Revisió humana i historial de la ubicació</button>
  {error&&<p role="alert">{error}</p>}
  {open&&data&&<div className="mt-2 space-y-2 rounded border p-3">
   {!data.available?<p>La revisió humana de geografia encara no està activada.</p>:<>
    <p>Estat: {data.current?(labels[data.current.decision??'']??'Pendent de revisió'):'Proposta obsoleta o absent: cal tornar a contrastar la font.'}</p>
    {data.current&&<>
     {data.current.review_id&&!data.current.review_valid&&<p role="alert">La revisió anterior ha quedat obsoleta: ha canviat el servei, el període o la font. Cal tornar a contrastar-la.</p>}
     <p>Proposta #{data.current.id} · {data.current.municipality} · Captura: {data.current.source_captured_at}</p>
     <p className="break-all">SHA-256 de la còpia: {data.current.source_sha256}</p>
     <a className="underline" href={`${url}&capture=bytes&proposalId=${data.current.id}&hash=${data.current.source_sha256}`} download>Descarregar la còpia HTML capturada</a>
     <details><summary>Transcripció de la captura · pendent de contrast amb els bytes originals</summary><pre className="max-h-80 overflow-auto whitespace-pre-wrap">{data.capture?.source_text}</pre><p className="break-all">SHA-256 del text: {data.capture?.source_text_sha256}</p></details>
     <p className="font-semibold">Confirmar la ubicació pot desbloquejar automàticament la foto econòmica: si la línia, el finançador, l’import, el període i els vincles ja estan revisats, l’import pot passar a formar part del saldo. Rebutjar o revocar aquesta ubicació pot tornar a deixar el saldo pendent.</p>
     <p>Contrasta la ubicació del servei i la correspondència del període amb la resolució. La confirmació no acredita el finançador ni valida cap import. La foto econòmica només aplicarà una confirmació vigent sense conflictes, mantenint la resta de validacions independents.</p>
     {data.current.conflict&&<p role="alert">Conflicte amb el territori o municipi documental vigent. No es pot confirmar aquesta proposta.</p>}
     <label className="block">Revisor declarat<input className="ml-2 rounded border p-1" value={reviewer} maxLength={200} onChange={e=>setReviewer(e.target.value)}/></label>
     <label className="block">Motiu i contrast del servei i període<textarea className="mt-1 block w-full rounded border p-1" value={rationale} maxLength={4000} onChange={e=>setRationale(e.target.value)}/></label>
     <label className="block"><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)}/> He contrastat la còpia capturada amb la transcripció i la correspondència del servei i període amb aquesta línia.</label>
     <div className="flex flex-wrap gap-3"><button type="button" disabled={!ready||data.current.conflict} onClick={()=>void save('confirmed')}>Confirmar ubicació</button><button type="button" disabled={!ready} onClick={()=>void save('rejected')}>Rebutjar proposta</button>{data.current.decision==='confirmed'&&<button type="button" disabled={!ready} onClick={()=>void save('revoked')}>Revocar confirmació</button>}</div>
    </>}
    <p>El revisor és una declaració registrada en una sessió d’accés compartit.</p>
    <ol>{data.history.map(h=><li key={h.id}>Proposta #{h.proposal_id} · {labels[h.decision]} · {h.reviewer} · {h.created_at}: {h.rationale}</li>)}</ol>
   </>}
  </div>}
 </div>;
}
