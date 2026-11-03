'use client';
import {useEffect,useState} from 'react';
import type {SourceDocument} from '@/lib/workbench-types';
import {summarizeSignatureObservations,type SignatureObservation} from '@/lib/concerts/signature-observations';
import {printedOriginalSignatureDates,proposedConcertAwardDate} from '@/lib/concerts/proposed-award-date';

const format=(date:string)=>date.replace(/^(\d{4})-(\d{2})-(\d{2})$/,'$3/$2/$1');
/** Display only: never writes award_date nor approves the record. */
export function ConcertProposedAwardDate({recordId,documents,extracted}:{recordId:string;documents:SourceDocument[];extracted:string|null}){
 const [result,setResult]=useState<{recordId:string;observations:SignatureObservation[]}|null>(null);
 useEffect(()=>{
  const controller=new AbortController();
  fetch(`/api/records/${recordId}/concert-signature`,{signal:controller.signal})
   .then(response=>response.ok?response.json():null)
   .then(body=>{if(body?.available===true&&Array.isArray(body.observations))setResult({recordId,observations:body.observations});else setResult({recordId,observations:[]});})
   .catch(()=>{if(!controller.signal.aborted)setResult({recordId,observations:[]});});
  return ()=>controller.abort();
 },[recordId]);
 const printed=printedOriginalSignatureDates(documents);
 if(printed===null)return <>{extracted?format(extracted):'No identificada'} · el document conté dates de signatura contradictòries; cal contrastar-les</>;
 const current=result?.recordId===recordId?result.observations.filter(item=>documents.some(document=>document.id===item.document_id&&document.archived===true&&document.revision?.startsWith(`${item.document_sha256}:`))):[];
 const summaries=summarizeSignatureObservations(current);
 const digital=summaries.some(summary=>summary.conflict||!summary.observation)?[]:summaries.map(summary=>summary.observation!.local_date);
 const proposal=proposedConcertAwardDate(printed,digital,extracted);
 if(!proposal)return <>{result?.recordId===recordId||printed.length?'No identificada':'Comprovant la data de signatura…'}</>;
 if(proposal.source==='extracted')return <>{format(proposal.date)}</>;
 return <><span className="font-medium">{format(proposal.date)}</span> · data concessió proposada ({proposal.source==='printed'?'signatura de l’original impresa al document':'signatura digital del document'}), pendent de validació humana{proposal.other&&<span className="block text-xs text-amber-800">{proposal.other===extracted?'L’extracció automàtica indicava':'La signatura digital indica'} {format(proposal.other)}; contrasta-les abans de validar.</span>}</>;
}
