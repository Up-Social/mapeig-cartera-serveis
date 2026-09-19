import {createServerSupabase} from '@/lib/records-page';
import {isUuid} from '@/lib/uuid';
import {executionMode} from '@/lib/pipeline/execution-mode';
import {assertTestEnvironment} from '@/lib/test-environment';
import {spawn} from 'node:child_process';
function configuration(){return {provider:process.env.PIPELINE_PROVIDER==='mock'?'mock':'openai',model:process.env.PIPELINE_PROVIDER==='mock'?'fixture-v1':process.env.OPENAI_MATCHING_MODEL??'not-configured'};}
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;if(!isUuid(id))return Response.json({error:'Lot no vàlid'},{status:400});
 const config=configuration();const r=await createServerSupabase().rpc('preflight_batch_rerun',{p_origin:id,p_provider:config.provider,p_model:config.model});
 return r.error?Response.json({error:'No es pot llegir el preflight.'},{status:409}):Response.json(r.data);
}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const {id}=await params,body=await request.json();if(!isUuid(id)||!isUuid(body.idempotencyKey)||typeof body.token!=='string'||body.confirmed!==true)return Response.json({error:'Cal confirmar el preflight.'},{status:400});
  const target=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  if(!['127.0.0.1','localhost','[::1]'].includes(target.hostname)&&process.env.ALLOW_REMOTE_BATCH_RERUN!=='true')return Response.json({error:'Rerun remot pendent d’autorització explícita.'},{status:403});
  const mode=executionMode(),config=configuration();if(config.provider==='mock')assertTestEnvironment(process.env);else if(mode==='disabled'||config.model==='not-configured')throw Error('Execution disabled');
  const db=createServerSupabase();const r=await db.rpc('create_batch_rerun',{p_origin:id,p_token:body.token,p_idempotency:body.idempotencyKey,p_provider:config.provider,p_model:config.model,p_executor:mode==='vercel_workflow'?'vercel_workflow':'local'});if(r.error)throw r.error;
  // Persisted identifiers are returned even if dispatch fails; never create another batch to retry dispatch.
  let dispatch='queued';
  if(!r.data.reused){try{
   if(config.provider==='mock'){const {runMockWorkflow}=await import('@/lib/mock-workflow');await runMockWorkflow(db,r.data.taskId);dispatch='completed';}
   else if(mode==='vercel_workflow'){const {launchCloudTask}=await import('@/lib/cloud/launch');dispatch=await launchCloudTask(r.data.taskId)?'started':'pending';}
   else if(mode==='local'){const child=spawn(process.execPath,['node_modules/tsx/dist/cli.mjs','scripts/run-operation-task.ts','--task-id',r.data.taskId],{cwd:process.cwd(),env:process.env,stdio:'ignore',detached:true});child.unref();dispatch='started';}
  }catch{dispatch='pending';}}
  return Response.json({...r.data,dispatch});
 }catch{return Response.json({error:'No s’ha creat el lot: preflight modificat, registres actius o configuració incompleta. Actualitza el preflight.'},{status:409});}
}
