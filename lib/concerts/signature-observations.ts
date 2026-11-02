export type SignatureObservation={document_id:string;document_sha256:string;claimed_utc:string;local_date:string;certificate_trust:string;verification_method:string;observed_at:string};

/** Identical retries agree; any differing claim for the same archived bytes
 * blocks presentation of a preferred date, regardless of writer or order. */
export function summarizeSignatureObservations(observations:SignatureObservation[]){
 const groups=new Map<string,SignatureObservation[]>();
 for(const observation of observations){
  const key=`${observation.document_id}:${observation.document_sha256}`;
  groups.set(key,[...(groups.get(key)??[]),observation]);
 }
 return [...groups.values()].map(items=>{
  const claims=new Set(items.map(item=>JSON.stringify([
   Number.isFinite(Date.parse(item.claimed_utc))?new Date(item.claimed_utc).toISOString():null,item.local_date,item.certificate_trust,item.verification_method,
  ])));
  const valid=items.every(item=>Number.isFinite(Date.parse(item.claimed_utc))&&/^\d{4}-\d{2}-\d{2}$/.test(item.local_date)&&['trusted','untrusted','unknown'].includes(item.certificate_trust)&&item.verification_method==='pdfsig-full-document-v1');
  const conflict=!valid||claims.size!==1;
  return {documentId:items[0].document_id,conflict,observation:conflict?null:items[0]};
 });
}
