import {originalSignatureEvidence,unambiguousOriginalSignature} from '@/lib/concerts/original-signature-evidence';
import type {SourceDocument} from '@/lib/workbench-types';

const format=(date:string)=>date.replace(/^(\d{4})-(\d{2})-(\d{2})$/,'$3/$2/$1');

/** Printed source evidence is a proposal, not a verified award date. */
export function ConcertOriginalSignature({documents,awardDate}:{documents:SourceDocument[];awardDate:string|null}){
 const rows=documents.flatMap(document=>{
  const coverage=document.extractionCoverage;
  if(document.status!=='fetched'||document.mimeType!=='application/pdf'||!document.archived||document.currentTextConsistent!==true||document.extractionPartial!==false||!coverage||typeof coverage!=='object'||!('complete' in coverage)||coverage.complete!==true||document.qualityFlags.some(flag=>['corrupt_text','incomplete_extraction'].includes(flag))||!document.extractedText)return [];
  const all=originalSignatureEvidence(document.extractedText);
  if(!all.length)return [];
  const match=unambiguousOriginalSignature(document.extractedText);
  const sha=document.revision?.split(':')[0]??'';
  return [{id:document.id,match,sha:/^[a-f0-9]{64}$/.test(sha)?sha:null}];
 });
 if(!rows.length)return null;
 return <section className="surface p-4 text-sm" aria-label="Dates del document original">
  <h3 className="font-semibold">Dates impreses al document · pendents de revisió</h3>
  {rows.map(({id,match,sha})=>{
   if(!match)return <p key={id} role="status" className="mt-2">El document conté dates originals contradictòries. Cal contrastar-les abans de seleccionar-ne cap.</p>;
   const first=match.find(item=>item.page!==null)??match[0];
   return <div key={id} className="mt-2">
    <p>El document indica la signatura de l’original el {format(first.date)}{first.copyDate?`; la còpia indica com a data de creació el ${format(first.copyDate)}`:''}.</p>
    {awardDate&&awardDate!==first.date&&<p role="status" className="mt-1">La data extreta ({format(awardDate)}) no coincideix amb la data de l’original; revisa el document abans de validar-la.</p>}
    {first.page&&sha&&<a className="underline" href={`/api/documents/${id}/open?sha=${sha}#page=${first.page}`} target="_blank" rel="noopener noreferrer">Consultar la pàgina {first.page} del document arxivat</a>}
   </div>;
  })}
  <p className="mt-2 text-muted-foreground">És una lectura del text imprès, no una verificació de signatura ni una modificació de la data d’adjudicació.</p>
 </section>;
}
