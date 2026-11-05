'use client';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import Link from 'next/link';
import type {ScopeProposalRow,BulkScopeResult} from '@/lib/convenis/scope-confirmation';

const RULE_LABELS:Record<string,string>={
 interadministrative_signatories:'«Altres Organismes Signants» buit',
 interadministrative_public_others:'Altres signants identificats com a públics',
};
/** Bulk confirmation of Excel-row discard proposals. The list is shown before
 * confirming and every record keeps its own audited decision and note. */
export function ConveniScopeBulkConfirm(){
 const router=useRouter();
 const [rows,setRows]=useState<ScopeProposalRow[]|null>(null);
 const [limit,setLimit]=useState(200);
 const [selected,setSelected]=useState<Set<string>>(new Set());
 const [note,setNote]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState<string|null>(null);
 const [result,setResult]=useState<BulkScopeResult|null>(null);
 const load=async()=>{
  setBusy(true);setError(null);
  try{
   const r=await fetch('/api/convenis/scope-proposals',{cache:'no-store'});const b=await r.json();
   if(!r.ok)throw Error(b.error??'No s’han pogut carregar les propostes.');
   setRows(b.proposals);setLimit(b.limit);setSelected(new Set((b.proposals as ScopeProposalRow[]).slice(0,b.limit).map(p=>p.id)));
  }catch(e){setError(e instanceof Error?e.message:'No s’han pogut carregar les propostes.');}
  finally{setBusy(false);}
 };
 const confirm=async()=>{
  setBusy(true);setError(null);
  try{
   const r=await fetch('/api/convenis/scope-proposals',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({recordIds:[...selected],note})});const b=await r.json();
   if(!r.ok)throw Error(b.error??'No s’han pogut confirmar les propostes.');
   setResult(b);setRows(current=>current?.filter(row=>!b.confirmed.includes(row.id))??null);setSelected(new Set());
   router.refresh();window.dispatchEvent(new Event('navigation-counts:refresh'));
  }catch(e){setError(e instanceof Error?e.message:'No s’han pogut confirmar les propostes.');}
  finally{setBusy(false);}
 };
 const toggle=(id:string)=>setSelected(current=>{const next=new Set(current);if(next.has(id))next.delete(id);else if(next.size<limit)next.add(id);return next;});
 return <section className="surface space-y-3 p-4">
  <div><h2 className="font-semibold">Propostes de descart de convenis a partir de l’Excel</h2>
   <p className="text-sm text-muted-foreground">Convenis interadministratius proposats per la fila de l’Excel, sense llegir el document ni consultar la IA. Revisa la llista abans de confirmar-los: la columna de signants pot ser incompleta.</p></div>
  {rows===null?<button className="rounded border px-3 py-2 text-sm" disabled={busy} onClick={()=>void load()}>{busy?'Carregant…':'Veure les propostes pendents'}</button>:<>
   <p className="text-sm" role="status">{rows.length} propostes pendents · {selected.size} seleccionades{rows.length>limit?` (màxim ${limit} per confirmació)`:''}.</p>
   {rows.length>0&&<div className="max-h-96 overflow-auto rounded border"><table className="w-full text-sm"><thead><tr className="text-left"><th className="p-2"><span className="sr-only">Seleccionar</span></th><th className="p-2">Conveni</th><th className="p-2">Motiu</th></tr></thead><tbody>
    {rows.map(row=><tr key={row.id} className="border-t align-top"><td className="p-2"><input type="checkbox" aria-label={`Seleccionar ${row.sourceRecordId}`} checked={selected.has(row.id)} onChange={()=>toggle(row.id)}/></td>
     <td className="p-2"><Link className="underline" href={`/records/${row.id}?job=${row.jobId}`}>{row.title}</Link><p className="text-xs text-muted-foreground">{row.sourceRecordId}</p></td>
     <td className="p-2">{RULE_LABELS[row.rule]??row.rule}</td></tr>)}
   </tbody></table></div>}
   {rows.length>0&&<><label className="block text-sm">Justificació de la decisió (s’aplica a cada conveni seleccionat)<textarea className="form-text mt-1" value={note} onChange={e=>setNote(e.target.value)} placeholder="Ex.: Revisats els signants de l’Excel: només hi signen administracions públiques."/></label>
    <button className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground" disabled={busy||!selected.size||note.trim().length<10} onClick={()=>void confirm()}>{busy?'Desant…':`Confirmar ${selected.size} descarts seleccionats`}</button></>}
  </>}
  {result&&<p className="text-sm" role="status">{result.confirmed.length} descarts confirmats.{result.failed.length?` ${result.failed.length} no s’han pogut desar: ${result.failed.map(f=>f.error).filter((v,i,a)=>a.indexOf(v)===i).join(' · ')}`:''}</p>}
  {error&&<p className="status-warning rounded p-3 text-sm" role="alert">{error}</p>}
 </section>;
}
