"use client";
import Link from 'next/link';
import {Dialog} from '@base-ui/react/dialog';
import type {BatchSummary} from '@/lib/batch-types';
import {FINANCING_TYPE_LABELS} from '@/lib/financing-types';
import {RetryJob} from './retry-job';
const labels={completed:'Completats',error:'Errors propis',blocked:'Bloquejats',pending:'Pendents',running:'En curs'};
export function BatchPhaseDialog({batch,phase,title,number}:{batch:BatchSummary;phase:keyof BatchSummary['progress'];title:string;number:string}){
 const totals=batch.progress[phase];
 return <Dialog.Root>
  <Dialog.Trigger className="rounded-xl border p-4 text-left hover:bg-muted focus-visible:outline-2">
   <span className="text-sm font-semibold">{number}. {title}</span>
   <p className="mt-3 text-sm">{totals.completed}/{totals.total} completats</p>
   <p className="mt-2 text-xs">{totals.errors} errors propis · {totals.blocked??0} bloquejats · {totals.pending??0} pendents · {totals.running??0} en curs</p>
   <span className="mt-2 block text-xs underline">Veure detall</span>
  </Dialog.Trigger>
  <Dialog.Portal><Dialog.Backdrop className="fixed inset-0 z-50 bg-black/30"/>
   <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[min(95vw,52rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-background p-5 shadow-xl">
    <Dialog.Title className="text-lg font-semibold">Lot {batch.batchNumber} · {title}</Dialog.Title>
    <Dialog.Description className="mt-2 text-sm">Cada registre pertany a una única categoria d’aquesta fase. Els errors anteriors bloquegen, però no afegeixen errors propis.</Dialog.Description>
    <Dialog.Close className="my-3 rounded border px-4 py-2 text-sm">Tancar</Dialog.Close>
    {(Object.entries(labels) as [keyof typeof labels,string][]).map(([state,label])=>{
     const jobs=batch.jobs.filter(j=>j.phases?.[phase]===state);
     return <section key={state} className="mt-4"><h3 className="font-semibold">{label} ({jobs.length})</h3><ul className="mt-2 space-y-2">
      {jobs.map(j=><li key={j.id} className="rounded border p-3 text-sm">
       <p>{j.externalId} · {FINANCING_TYPE_LABELS[j.financingType]}</p><p className="font-medium">{j.title}</p>
       <p>{j.preparationMessage||j.enrichmentError||j.errorMessage||'Sense incidència registrada'}</p>
       <Link className="mt-2 inline-block underline" href={`/review?state=all&batch=${batch.id}&record=${j.sourceRecordId}&job=${j.id}`}>Obrir resultat i evidència</Link>
       {j.isCurrent&&state==='error'&&!batch.isActive&&<RetryJob recordId={j.sourceRecordId} jobId={j.id} operation={phase==='preparation'?'prepare':phase==='enrichment'?'enrich':'match'}/>}
      </li>)}
     </ul></section>;
    })}
   </Dialog.Popup>
  </Dialog.Portal>
 </Dialog.Root>;
}
