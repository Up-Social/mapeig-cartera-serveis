export type ExecutionStatus={state:string;label:string;lastProgress:string|null;recoverable:boolean;reason:string|null};
export function executionStatus(task:{execution_state:string;lease_until:string|null;last_progress_at:string|null;failure_kind:string|null},now=Date.now()):ExecutionStatus{
 let state=task.execution_state;
 if(state==='running'&&task.lease_until&&Date.parse(task.lease_until)<now)state='interrupted';
 if(state==='pending'&&task.last_progress_at)state=now-Date.parse(task.last_progress_at)>15*60_000?'interrupted':'running';
 const labels:Record<string,string>={pending:'Pendent d’inici',running:'En execució',paused:task.failure_kind?.includes('quota')?'Pausat per quota':'Execució pausada',interrupted:'Interromput',completed:'Execució finalitzada'};
 return {state,label:labels[state]??'Pendent d’inici',lastProgress:task.last_progress_at,recoverable:['pending','paused','interrupted'].includes(state)&&task.failure_kind!=='provider_unknown'&&task.failure_kind!=='budget',reason:task.failure_kind};
}
