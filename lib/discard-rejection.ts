/** An explicit server rejection means the delete transaction did not commit. */
export function isKnownDiscardRejection(status:number,rejection:unknown):boolean{
 return (status===400&&rejection==='invalid_selection')||
  (status===409&&typeof rejection==='string'&&['preserved_history','population_history','concert_evidence_retained'].includes(rejection));
}
