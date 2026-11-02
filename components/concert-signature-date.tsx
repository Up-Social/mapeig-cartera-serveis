'use client';
import {useEffect,useState} from 'react';
import type {SourceDocument} from '@/lib/workbench-types';
import {summarizeSignatureObservations,type SignatureObservation} from '@/lib/concerts/signature-observations';

type Observation=SignatureObservation;
export function ConcertSignatureDate({recordId,documents}:{recordId:string;documents:SourceDocument[]}){
 const [result,setResult]=useState<{recordId:string;observations:Observation[];error?:boolean}|null>(null);
 useEffect(()=>{
  const controller=new AbortController();
  fetch(`/api/records/${recordId}/concert-signature`,{signal:controller.signal})
   .then(response=>{if(!response.ok)throw Error('SIGNATURE_UNAVAILABLE');return response.json();})
   .then(body=>{if(body?.available===true&&Array.isArray(body.observations))setResult({recordId,observations:body.observations});})
   .catch(()=>{if(!controller.signal.aborted)setResult({recordId,observations:[],error:true});});
  return ()=>controller.abort();
 },[recordId]);
 const current=result?.recordId===recordId?result.observations.filter(item=>
  documents.some(document=>document.id===item.document_id&&document.archived===true&&document.revision?.startsWith(`${item.document_sha256}:`))):[];
 if(result?.recordId===recordId&&result.error)return <p role="status" className="mt-3 rounded-lg border p-3 text-sm">No s’ha pogut consultar la informació de signatura. La data continua pendent de contrast.</p>;
 if(!current.length)return null;
 const summaries=summarizeSignatureObservations(current);
 return <div className="mt-3 rounded-lg border p-3 text-sm">
  <p className="font-semibold">Data declarada a la signatura digital · pendent de revisió</p>
  {summaries.map(summary=>{
   if(summary.conflict||!summary.observation)return <p key={summary.documentId} role="alert" className="mt-2">Observacions de signatura contradictòries al document arxivat {summary.documentId}. No es proposa cap data; cal revisar les comprovacions.</p>;
   const item=summary.observation;
   return <p key={item.document_id} className="mt-2">
   {/^\d{4}-\d{2}-\d{2}$/.test(item.local_date)?item.local_date.replace(/^(\d{4})-(\d{2})-(\d{2})$/,'$3/$2/$1'):'Data no disponible'} · document arxivat {item.document_id}.
   {' '}{item.certificate_trust==='trusted'?'Certificat acceptat en la comprovació disponible.':item.certificate_trust==='untrusted'?'No s’ha pogut establir confiança en el certificat.':'Confiança del certificat desconeguda.'}
  </p>;})}
  <p className="mt-2 text-muted-foreground">Les observacions registren comprovacions d’integritat de tot el PDF; si discrepen, la data queda bloquejada. La data és declarada pel signant i no acredita un segell de temps fiable ni substitueix la data d’adjudicació.</p>
 </div>;
}
