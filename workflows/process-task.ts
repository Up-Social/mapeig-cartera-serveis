import {sleep,getWorkflowMetadata} from 'workflow';
export async function processCloudTask(task:string){
 'use workflow';
 const {workflowRunId}=getWorkflowMetadata();
 for(let units=0;units<400;units++){
  const result=await advanceStep(task,workflowRunId);
  if(result.done)return;
  await sleep(`${result.wait}s`);
 }
 await continueStep(task);
}
async function advanceStep(task:string,workflow:string){
 'use step';
 try {const {advance}=await import('../lib/cloud/advance');return await advance(task,workflow);}
 catch {return {done:true,wait:0};} // Lease expiry + reconciler recover an interrupted step.
}
advanceStep.maxRetries=0;
async function continueStep(task:string){
 'use step';
 const {launchCloudTask}=await import('../lib/cloud/launch');await launchCloudTask(task);
}
continueStep.maxRetries=0;
