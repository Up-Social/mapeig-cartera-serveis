export type ConveniUnitState={source_record_id:string;approved_units:number;pending_units:number};
/** Presentation only: never rewrites persisted job or record states. */
export function conveniBatchState(value:ConveniUnitState|undefined):'partial'|'approved'|'review'|null{
 if(!value)return null;
 if(value.pending_units>0)return value.approved_units>0?'partial':'review';
 return value.approved_units>0?'approved':null;
}
export function mergeConveniBatchAttention<T extends {id:string;run_id:string|null;destination:string;classification:string|null}>(rows:T[],states:ConveniUnitState[]):Array<T&{conveniState:'partial'|'approved'|'review'|null}>{
 const byId=new Map(states.map(state=>[state.source_record_id,state]));
 return rows.map(row=>{const state=conveniBatchState(byId.get(row.id));return {...row,conveniState:state,destination:state==='partial'||state==='review'?(row.destination==='issues'?'issues':'review'):row.destination};});
}
