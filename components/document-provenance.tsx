import type {SourceDocument} from '@/lib/workbench-types';
export function DocumentProvenance({document}:{document:SourceDocument}){
 const r=document.resolution;if(!r)return null;
 return <div className="mt-2 text-xs text-muted-foreground"><p>{r.result==='resolved'?'Relació oficial acreditada':'Resolució pendent'} · {r.method} · {r.case_id||'Expedient no acreditat'}</p>{r.diagnostic&&<p>{r.diagnostic}</p>}<a href={r.original_url} target="_blank" rel="noreferrer" className="underline">Publicació original</a></div>;
}
