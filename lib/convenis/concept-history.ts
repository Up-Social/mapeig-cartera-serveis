export type ConceptEventKey={job_id:string;unit_id:string;concept_index:number};
/** Indices only identify a concept inside its original analysis and unit. */
export function eventsForConcept<T extends ConceptEventKey>(events:readonly T[],jobId:string,unitId:string,index:number):T[] {
 return events.filter(event=>event.job_id===jobId&&event.unit_id===unitId&&event.concept_index===index);
}

/** Same array index does not establish that the reviewed snapshot is the same. */
export function conceptHistoryVersion(currentHash:unknown,eventHash:unknown):'same'|'different'|'unknown' {
 if(typeof currentHash!=='string'||typeof eventHash!=='string'||!(/^[a-f0-9]{64}$/.test(currentHash)&&/^[a-f0-9]{64}$/.test(eventHash)))return 'unknown';
 return currentHash===eventHash?'same':'different';
}
