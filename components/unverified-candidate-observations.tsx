import type {UnverifiedCandidateObservation} from '@/lib/workbench-types';

/** This section is read-only; it never makes an observation selectable. */
export function UnverifiedCandidateObservations({observations}:{observations:readonly UnverifiedCandidateObservation[]|undefined}) {
 if(!observations?.length)return null;
 return <section aria-label="Propostes conservades pendents de contrast" className="rounded-xl border border-amber-300 bg-amber-50/50 p-4 text-sm">
  <h3 className="font-semibold">Propostes conservades pendents de contrast</h3>
  <p className="mt-2">Aquests codis no consten entre les prestacions finals del catàleg local de visualització. Poden ser agrupadors o correspondre a una altra versió. Es mostren com a referència, sense acreditar-ne l’assignació; no es poden seleccionar aquí.</p>
  <div className="mt-3 space-y-3">{observations.map((observation,index)=><article key={`${observation.id}-${index}`} className="min-w-0 rounded-lg border bg-white p-3">
   <p className="break-words font-semibold">{observation.targetCode??'Codi no informat'} · {observation.targetName??'Nom no informat'}</p>
   <p className="mt-1 text-xs text-muted-foreground">Versió registrada: {observation.catalogVersionId??'no informada'} · pendent de contrast</p>
   {observation.rationale&&<p className="mt-2 whitespace-pre-wrap break-words">Justificació registrada: {observation.rationale}</p>}
   {observation.evidence.length>0&&<div className="mt-2 space-y-2"><p className="font-semibold">Fragments guardats</p>{observation.evidence.map((item,i)=><div key={i} className="border-l-2 pl-3">
    {item.ordinal!==null&&<p className="text-xs">Fragment {item.ordinal}</p>}
    {item.explanation&&<p className="whitespace-pre-wrap break-words">Explicació registrada: {item.explanation}</p>}
    {item.content&&<blockquote className="whitespace-pre-wrap break-words">{item.content}</blockquote>}
   </div>)}</div>}
  </article>)}</div>
 </section>;
}
