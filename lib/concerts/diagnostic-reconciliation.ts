import {storedAmountCents} from './annex-extraction';
export type DiagnosticReconciliation={revision:number;maximum_net_cents:number;calculated_net_cents:number;calculated_gross_cents:number;unit_proof:Array<{unit_id:string;page:number;net_cents:number;gross_cents:number;reses:string;code:string}>};
const natural=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
/** A malformed, partial or internally inconsistent receipt is never displayed as reconciled. */
export function parseDiagnosticReconciliation(value:unknown):DiagnosticReconciliation|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const v=value as Record<string,unknown>;
 if(!natural(v.revision)||v.revision<1||!natural(v.maximum_net_cents)||!natural(v.calculated_net_cents)||!natural(v.calculated_gross_cents)||v.maximum_net_cents!==v.calculated_net_cents||!Array.isArray(v.unit_proof)||v.unit_proof.length<1||v.unit_proof.length>1000)return null;
 const rows:DiagnosticReconciliation['unit_proof']=[];const ids=new Set<string>(),pages=new Set<number>();let net=0,gross=0;
 for(const raw of v.unit_proof){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const row=raw as Record<string,unknown>;
  if(typeof row.unit_id!=='string'||!row.unit_id||!natural(row.page)||row.page<1||!natural(row.net_cents)||!natural(row.gross_cents)||typeof row.reses!=='string'||!row.reses||typeof row.code!=='string'||!row.code||ids.has(row.unit_id)||pages.has(row.page))return null;
  ids.add(row.unit_id);pages.add(row.page);net+=row.net_cents;gross+=row.gross_cents;
  if(!Number.isSafeInteger(net)||!Number.isSafeInteger(gross))return null;
  rows.push({unit_id:row.unit_id,page:row.page,net_cents:row.net_cents,gross_cents:row.gross_cents,reses:row.reses,code:row.code});
 }
 if(net!==v.calculated_net_cents||gross!==v.calculated_gross_cents)return null;
 return {revision:v.revision,maximum_net_cents:v.maximum_net_cents,calculated_net_cents:v.calculated_net_cents,calculated_gross_cents:v.calculated_gross_cents,unit_proof:rows};
}

export function parseDiagnosticReconciliationStatus(value:unknown):{status:'disabled'|'absent'|'current'|'unavailable';report:DiagnosticReconciliation|null}{
 if(!value||typeof value!=='object'||Array.isArray(value))return {status:'unavailable',report:null};
 const v=value as Record<string,unknown>;
 if(typeof v.recognized!=='boolean'||!('report' in v))return {status:'unavailable',report:null};
 if(!v.recognized)return v.report===null?{status:'disabled',report:null}:{status:'unavailable',report:null};
 if(v.report===null)return {status:'absent',report:null};
 const report=parseDiagnosticReconciliation(v.report);
 return report?{status:'current',report}:{status:'unavailable',report:null};
}

/** Do not mix a receipt and line list read in different, changed snapshots. */
export function matchesDiagnosticReconciliation(receipt:DiagnosticReconciliation|null,comparison:{declaredNetCents:number|null;totalCents:number}|null,units:readonly {id:string;page:number|null;reses_code:string|null;observed_service_code:string|null;amount:number|string|null}[]):boolean{
 return !!receipt&&!!comparison&&receipt.unit_proof.length===units.length&&receipt.maximum_net_cents===comparison.declaredNetCents&&receipt.calculated_gross_cents===comparison.totalCents&&receipt.unit_proof.every(row=>units.some(unit=>unit.id===row.unit_id&&unit.page===row.page&&unit.reses_code===row.reses&&unit.observed_service_code===row.code&&storedAmountCents(unit.amount)===row.gross_cents));
}
