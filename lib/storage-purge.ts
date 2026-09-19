export type PurgeTarget={id:string;bucket:string;path:string};
export type PurgeAdapter={remove:(bucket:string,path:string)=>Promise<void>;exists:(bucket:string,path:string)=>Promise<boolean>;record:(id:string,complete:boolean,error:string|null)=>Promise<void>};
export async function purgeTargets(targets:PurgeTarget[],adapter:PurgeAdapter){
 let pending=0;
 for(const target of targets){
  try{await adapter.remove(target.bucket,target.path);if(await adapter.exists(target.bucket,target.path))throw Error('still_present');await adapter.record(target.id,true,null);}
  catch{pending++;await adapter.record(target.id,false,'No s’ha pogut verificar la purga. Reintenta la neteja.');}
 }
 return {pending,complete:pending===0};
}
