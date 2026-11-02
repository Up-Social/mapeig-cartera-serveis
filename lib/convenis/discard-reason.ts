import {missingDiscardDiagnostic} from './missing-discard';
/** Presentation only. Historical proposals remain unchanged and this never
 * infers who signed, received funds, or whether the agreement is in scope. */
export function conveniDiscardReason(reason:string|null|undefined){
 const original=typeof reason==='string'?reason.trim():'';
 if(!original)return {label:'Motiu no indicat a la proposta',explanation:'Cal contrastar el motiu amb el document abans de decidir.'};
 const missing=missingDiscardDiagnostic(original);
 if(missing)return {label:original,explanation:`${missing.message} Es conserva el motiu registrat; cal revisar la proposta històrica.`};
 if(original==='service_not_in_catalog')return {label:'Servei no identificat a la cartera',explanation:'La manca d’encaix en el catàleg no justifica per si sola un descart. Cal revisar la naturalesa social i el motiu documentat.'};
 if(original==='interadministrative_agreement')return {label:'Conveni interadministratiu',explanation:null};
 if(original==='excluded_amendment')return {label:'Addenda, pròrroga o modificació fora de l’abast',explanation:null};
 return {label:original,explanation:null};
}
