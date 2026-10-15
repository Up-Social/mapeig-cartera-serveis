export type DocumentedCorrection={id:string;unit_id:string|null;field:string;value:string;previous_value:string|null;document_id:string;document_revision:string;page:number;evidence:string;visual_check:boolean;reason:string;reviewer:string;valid:boolean;created_at:string};
export type Reservation={id:string;pipeline_job_id:string;action:'accept'|'reopen';reason:string;missing_items:string;reviewer:string;created_at:string};
export function currentReservation(record:{currentJobId?:string|null;reservation?:Reservation|null;isHistorical?:boolean}) {
 return !record.isHistorical&&record.reservation&&record.reservation.pipeline_job_id===record.currentJobId&&record.reservation.action==='accept'?record.reservation:null;
}
export function effectiveUnitCode(unit:{id:string;observed_service_code:string|null},corrections:DocumentedCorrection[]){
 return corrections.find(c=>c.valid&&c.unit_id===unit.id&&c.field==='service_code')?.value??unit.observed_service_code;
}
export function canResolveManually(record:{isHistorical?:boolean;currentJobId?:string|null;currentJobStatus?:string|null;operationProgress?:{state:string}|null}){
 return !record.isHistorical&&!!record.currentJobId&&['needs_review','insufficient_evidence','rejected','error'].includes(record.currentJobStatus??'')&&!['active','waiting'].includes(record.operationProgress?.state??'');
}
