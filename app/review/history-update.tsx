"use client";
import Link from 'next/link';
import {useState,useTransition} from 'react';
import {Button} from '@/components/ui/button';
export function HistoryUpdate({runId}:{runId:string|null}) {
 const [id,setId]=useState(runId);const [message,setMessage]=useState('');const [pending,startTransition]=useTransition();
 return <aside className="surface mt-5 flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
  <div><p className="font-semibold">Actualització de l’històric</p><p className="mt-1 text-neutral-600">Només anàlisis antigues sense classificació normativa ni decisió humana. Es conserven els resultats anteriors.</p>
  <p className="mt-1 text-xs text-neutral-500">Execució al núvol, amb límit preventiu de 4 USD d’IA. Les propostes noves continuen requerint revisió.</p></div>
  {id?<Link className="font-semibold underline underline-offset-4" href={`/batches?batch=${id}`}>Veure progrés de l’històric</Link>:<Button variant="outline" disabled={pending} onClick={()=>startTransition(async()=>{
   try {const response=await fetch('/api/batches/operation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'reclassify_history'})});const data=await response.json();if(!response.ok)throw Error(data.error??'No s’ha pogut iniciar.');setId(data.result.id);if(!data.result.id)setMessage('No hi ha anàlisis antigues elegibles.');}catch(error){setMessage(error instanceof Error?error.message:'No s’ha pogut iniciar.');}
  })}>{pending?'Preparant…':'Actualitzar anàlisis antigues'}</Button>}
  {message&&<p role="status" className="w-full">{message}</p>}
 </aside>;
}
