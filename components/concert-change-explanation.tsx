import React from 'react';

/** Explain the signed change without claiming a previous or final total. */
export function ConcertChangeExplanation({actType,origin,quantityDelta}:{actType:string;origin:string|null;quantityDelta:number|null}){
 if(actType!=='modification'||origin!=='official-change-v1'||!Number.isSafeInteger(quantityDelta)||!quantityDelta)return null;
 const quantity=Math.abs(quantityDelta),label=quantity===1?'plaça':'places';
 return <p className="mt-3 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
  {quantityDelta>0?`L’annex indica un increment de ${quantity} ${label} en aquest acte.`:`L’annex indica una reducció de ${quantity} ${label} en aquest acte.`}{' '}
  És un canvi, no el total de places del concert. Per conèixer el total anterior i el resultant, cal identificar i revisar la resolució original i els canvis posteriors.
 </p>;
}
