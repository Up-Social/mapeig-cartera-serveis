import {isUuid} from '@/lib/uuid';

export type PreparationObservation={event_id:string;document_id:string;page:number;role:string;quote:string;declared_reviewer:string;created_at:string};
type HistoryEvent={id:string;job_id:string;outcome:string;reason:string;created_at:string;declared_actor:string;previous:unknown};
export type HistorySnapshot={record_id:string;job_id:string;unit_id:string;previous_id:string;events:HistoryEvent[]};
export type VersionedHistory={record_id:string;unit_id:string;previous_id:string|null;events:Array<HistoryEvent&{amount_cents:number;service_code:string}>};
export type PreparationOperation={id:string;ids:{ackId:string;draftId:string;receiptId:string;linkId:string};payload:Record<string,unknown>&{reviewer:string;note:string;literal:string;monetaryId:string;identityId:string;rolePeriodId:string;historySnapshot:HistorySnapshot|null};state:'pending'|'ready'};
export type PreparationPreview={preparationGuard?:{blocked:boolean};independent:boolean;versionedHistory:VersionedHistory|null;history:{hasHistory:boolean;snapshot?:HistorySnapshot};observations:PreparationObservation[];operation:PreparationOperation|null;historyUnavailable:boolean;reconciliationAvailable:boolean;operationHistory:Array<{id:string;state:string;created_at:string;supersession_reason:string|null}>};

const object=(v:unknown):v is Record<string,unknown>=>typeof v==='object'&&v!==null&&!Array.isArray(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&isUuid(v);
const date=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const event=(v:unknown):v is HistoryEvent=>object(v)&&uuid(v.id)&&uuid(v.job_id)&&typeof v.outcome==='string'&&typeof v.reason==='string'&&date(v.created_at)&&typeof v.declared_actor==='string';
const history=(v:unknown,recordId:string,jobId:string,unitId:string):v is HistorySnapshot=>object(v)&&v.record_id===recordId&&v.job_id===jobId&&v.unit_id===unitId&&uuid(v.previous_id)&&Array.isArray(v.events)&&v.events.length>0&&v.events.every(event)&&new Set(v.events.map((e:HistoryEvent)=>e.id)).size===v.events.length&&v.events.at(-1)?.id===v.previous_id;
const versionedHistory=(v:unknown,recordId:string,unitId:string):v is VersionedHistory=>object(v)&&v.record_id===recordId&&v.unit_id===unitId&&(v.previous_id===null||uuid(v.previous_id))&&Array.isArray(v.events)&&v.events.every((e:unknown)=>event(e)&&Number.isSafeInteger((e as Record<string,unknown>).amount_cents)&&typeof (e as Record<string,unknown>).service_code==='string')&&new Set(v.events.map((e:HistoryEvent)=>e.id)).size===v.events.length&&(v.previous_id===null?v.events.length===0:v.events.at(-1)?.id===v.previous_id);
const observation=(v:unknown):v is PreparationObservation=>object(v)&&uuid(v.event_id)&&uuid(v.document_id)&&Number.isSafeInteger(v.page)&&Number(v.page)>0&&typeof v.role==='string'&&typeof v.quote==='string'&&typeof v.declared_reviewer==='string'&&date(v.created_at);

/** The screen must not reuse an old preparation when its read is incomplete. */
export function parsePreparationPreview(value:unknown,recordId:string,jobId:string,unitId:string):PreparationPreview {
 const invalid=():never=>{throw Error('No es pot verificar la resposta de preparació. Torna a carregar les fonts i l’historial.');};
 if(!object(value)||typeof value.independent!=='boolean'||!object(value.history)||typeof value.history.hasHistory!=='boolean'
  ||!Array.isArray(value.observations)||!value.observations.every(observation)||!Object.hasOwn(value,'operation')
  ||typeof value.historyUnavailable!=='boolean'||typeof value.reconciliationAvailable!=='boolean'||!Array.isArray(value.operationHistory))return invalid();
 if(Object.hasOwn(value,'preparationGuard')&&(!object(value.preparationGuard)||typeof value.preparationGuard.blocked!=='boolean'))return invalid();
 if(value.history.hasHistory===true&&!history(value.history.snapshot,recordId,jobId,unitId))return invalid();
 if(value.history.hasHistory===false&&value.history.snapshot!=null)return invalid();
 if(value.historyUnavailable&&value.operation===null)return invalid();
 const versioned=value.versionedHistory;
 if(versioned!==null&&!versionedHistory(versioned,recordId,unitId))return invalid();
 if(value.operation!==null){
  const o=value.operation;
  if(!object(o)||!uuid(o.id)||o.record_id!==recordId||o.job_id!==jobId||o.unit_id!==unitId||(o.state!=='pending'&&o.state!=='ready')||!object(o.ids)||!['ackId','draftId','receiptId','linkId'].every(k=>uuid(o.ids&&object(o.ids)?o.ids[k]:undefined))||!object(o.payload)
   ||o.payload.jobId!==jobId||o.payload.unitId!==unitId||!['reviewer','note','literal','monetaryId','identityId','rolePeriodId'].every(k=>typeof (o.payload as Record<string,unknown>)[k]==='string')
   ||(o.payload.historySnapshot!==null&&!history(o.payload.historySnapshot,recordId,jobId,unitId))
   ||(value.independent&&Object.hasOwn(o.payload,'versionedHistorySnapshot')&&o.payload.versionedHistorySnapshot!==null&&!versionedHistory(o.payload.versionedHistorySnapshot,recordId,unitId)))return invalid();
 }
 if(!value.operationHistory.every((o:unknown)=>object(o)&&uuid(o.id)&&typeof o.state==='string'&&date(o.created_at)&&(o.supersession_reason===null||typeof o.supersession_reason==='string')))return invalid();
 return value as PreparationPreview;
}
