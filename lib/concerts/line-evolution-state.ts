/** Use only the code delivered by the verified ledger projection. */
type Unit={id:string;service_code:string|null;source_fingerprint:string;line_award_state?:'current'|'stale'};
type Row={unit_id:string;state:unknown;service_code?:unknown};
export function applyVerifiedLineStates<T extends Unit>(units:T[],rows:Row[]):T[]{
 if(!Array.isArray(rows)||rows.length!==units.length||new Set(units.map(unit=>unit.id)).size!==units.length)throw Error('No s’ha pogut comprovar l’estat de totes les adjudicacions.');
 const requested=new Set(units.map(unit=>unit.id));const states=new Map<string,Row>();
 for(const row of rows){
  if(!row||typeof row.unit_id!=='string'||!requested.has(row.unit_id)||states.has(row.unit_id)||!['legacy','current','stale'].includes(String(row.state)))throw Error('No s’ha pogut comprovar l’estat de totes les adjudicacions.');
  if(row.state!=='current'&&row.service_code!=null)throw Error('No s’ha pogut comprovar l’estat de totes les adjudicacions.');
  states.set(row.unit_id,row);
 }
 return units.map(unit=>{
  const row=states.get(unit.id);if(!row)throw Error('No s’ha pogut comprovar l’estat de totes les adjudicacions.');
  if(row.state==='legacy')return unit;
  if(row.state!=='current')return {...unit,line_award_state:'stale'};
  if(typeof row.service_code!=='string'||!row.service_code.trim())return {...unit,service_code:null,line_award_state:'stale'};
  return {...unit,service_code:row.service_code,line_award_state:'current'};
 });
}
