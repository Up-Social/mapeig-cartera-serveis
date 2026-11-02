import 'server-only';
import {createServerSupabase} from './records-page';
import {executionMode} from './pipeline/execution-mode';
import {assertProcessingEnabled} from './processing-control';
import {requireUuid} from './uuid';

export type ConcertReprocessResult={runId:string;jobId:string;taskId:string;attemptId:string;newJob:true};
export class ConcertReprocessError extends Error {
 constructor(public code:string,message:string,public result?:ConcertReprocessResult){super(message);}
}
/** A dedicated, atomic full reprocess. Never falls back to the legacy operation
 * when the release migration is absent, or launches a local background worker. */
export async function startConcertReprocess(recordId:string,expectedJobId:string|null){
 requireUuid(recordId);if(expectedJobId!==null)requireUuid(expectedJobId);
 if(executionMode()!=='vercel_workflow')throw new ConcertReprocessError('CONCERT_EXECUTION_DISABLED','El reprocessament complet de Concerts només està disponible a producció.');
 const db=createServerSupabase();
 try{await assertProcessingEnabled(db);}catch{throw new ConcertReprocessError('CONCERT_EXECUTION_DISABLED','No s’ha pogut confirmar que el processament estigui habilitat. No s’ha iniciat cap operació; consulta Administració.');}
 const r=await db.rpc('begin_concert_reprocess',{p_record:recordId,p_executor:'vercel_workflow',p_expected_job:expectedJobId});
 if(r.error){
  const message=r.error.message??'';
  if(message.includes('CONCERT_REPROCESS_STALE_JOB'))throw new ConcertReprocessError('CONCERT_STALE_JOB','El cas ha canviat. Actualitza la fitxa abans de tornar a processar.');
  if(message.includes('PROCESSING_DISABLED'))throw new ConcertReprocessError('CONCERT_EXECUTION_DISABLED','El processament està aturat. Consulta Administració.');
  if(message.includes('CONCERT_REPROCESS_SCOPE'))throw new ConcertReprocessError('CONCERT_SCOPE_INVALID','Aquesta operació només és vàlida per a Concerts.');
  if(message.includes('ACTIVE_TASK')||r.error.code==='55P03')throw new ConcertReprocessError('ACTIVE_TASK','Ja hi ha una operació en curs o el cas està ocupat. Comprova’n el progrés.');
  if(message.includes('PROVIDER_')||message.includes('OCR_JOURNAL_'))throw new ConcertReprocessError('CONCERT_RECONCILIATION_REQUIRED','Hi ha una operació anterior pendent de comprovació. Cal resoldre-la abans de repetir el processament.');
  if(['42883','PGRST202'].includes(r.error.code??''))throw new ConcertReprocessError('CONCERT_RELEASE_NOT_READY','El reprocessament complet encara no està disponible: falta instal·lar la migració d’aquesta versió.');
  throw new ConcertReprocessError('CONCERT_START_UNCERTAIN','No s’ha pogut confirmar l’inici. Comprova l’estat del cas abans de tornar a enviar la petició.');
 }
 const result=r.data as ConcertReprocessResult;
 if(!result?.jobId||!result.taskId||!result.runId||result.newJob!==true)throw new ConcertReprocessError('CONCERT_START_UNCERTAIN','No s’ha pogut confirmar l’inici. Comprova l’estat del cas abans de repetir.');
 const {launchCloudTask}=await import('./cloud/launch');
 if(!await launchCloudTask(result.taskId))throw new ConcertReprocessError('CONCERT_DISPATCH_PENDING','L’operació està registrada, però no s’ha confirmat el llançament. Comprova’n l’estat; no iniciïs una altra anàlisi.',result);
 return result;
}
