import {isUuid} from './uuid';
export type OcrRecovery={documentId:string;pages:number[]};
/** Explicit opt-in to a bounded second reading, independent of the analysis model. */
export function validateOcrRecovery(value:unknown):OcrRecovery {
 const v=value as Partial<OcrRecovery>|null;
 if(!v||!isUuid(v.documentId??'')||!Array.isArray(v.pages)||!v.pages.length||v.pages.length>25||v.pages.some(p=>!Number.isInteger(p)||p<1||p>2000))throw Error('Selecciona un PDF i entre 1 i 25 pàgines vàlides.');
 return {documentId:v.documentId!,pages:[...new Set(v.pages)].sort((a,b)=>a-b)};
}
