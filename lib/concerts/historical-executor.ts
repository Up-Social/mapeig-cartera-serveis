import {createHash} from 'node:crypto';
import {HISTORICAL_CONCERT_TERMS,type HistoricalPage} from './historical-discovery';
import {buildHistoricalConcertImportPlan} from './historical-import-plan';
import {nextHistoricalAction,type HistoricalSnapshot} from './historical-runner';
import {historicalCanonicalHash} from './historical-canonical';

type SelectedAction=ReturnType<typeof nextHistoricalAction>;
type WorkAction=Extract<SelectedAction,{kind:'fetch_page'|'persist_manifest'|'import_batch'|'verify_and_complete'}>;
type Lease={owner:string;generation:number};
export type HistoricalProgress={phase:'reading_pages'|'preparing_import'|'importing'|'verifying';pagesRead:number;pagesTotal:number|null;recordsSaved:number;recordsTotal:number|null};
type Reservation={id:string;action:WorkAction;progress:HistoricalProgress};

/** Backend adapter contract. All writes must be fenced by lease and scope.
 * begin atomically compares revision, records the full action/intent and its
 * progress, and returns true to only one caller. A false response must have no
 * effect. apply must atomically validate the reserved action, persist its
 * result, update progress/receipts and clear intent. For completion it must
 * revalidate pages, manifest, receipts and unsettled effects in the database.
 * The executor receives its persistent store and source from the dedicated workflow. */
export interface HistoricalStore {
 read(attemptId:string,lease:Lease):Promise<{revision:string;snapshot:HistoricalSnapshot}>;
 begin(attemptId:string,lease:Lease,revision:string,reservation:Reservation):Promise<boolean>;
 apply(attemptId:string,lease:Lease,reservation:Reservation,result:{page?:HistoricalPage;pageHash?:string}):Promise<void>;
}
export interface HistoricalSource {
 readPage(term:typeof HISTORICAL_CONCERT_TERMS[number],page:number,signal:AbortSignal):Promise<unknown>;
}

function progress(snapshot:HistoricalSnapshot,action:WorkAction):HistoricalProgress {
 const pagesRead=snapshot.queries.reduce((total,q)=>total+q.pages.length,0);
 const totals=snapshot.queries.map(q=>q.pages[0]).filter(Boolean);
 const pagesTotal=totals.length===2?totals.reduce((sum,p)=>sum+Math.max(1,p.totalPages),0):null;
 let recordsTotal:number|null=null;
 if(action.kind!=='fetch_page')recordsTotal=buildHistoricalConcertImportPlan(snapshot.queries,snapshot.retrievedAt).rows.length;
 return {phase:action.kind==='fetch_page'?'reading_pages':action.kind==='persist_manifest'?'preparing_import':action.kind==='import_batch'?'importing':'verifying',
  pagesRead,pagesTotal,recordsSaved:snapshot.receipts.length,recordsTotal};
}
function validatePage(value:unknown,page:number):HistoricalPage {
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('INVALID_PAGE');
 const candidate=value as Partial<HistoricalPage>;
 if(candidate.currentPage!==page||!Number.isSafeInteger(candidate.totalEdictes)||Number(candidate.totalEdictes)<0||
  !Number.isSafeInteger(candidate.totalPages)||Number(candidate.totalPages)<0||Number(candidate.totalPages)>5000||
  !Array.isArray(candidate.edictes)||candidate.edictes.length>25)throw new Error('INVALID_PAGE');
 const json=JSON.stringify(value);
 if(typeof json!=='string'||Buffer.byteLength(json,'utf8')>2_000_000)throw new Error('INVALID_PAGE');
 return JSON.parse(json) as HistoricalPage;
}
async function readPage(source:HistoricalSource,term:typeof HISTORICAL_CONCERT_TERMS[number],page:number,timeoutMs:number):Promise<HistoricalPage>{
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 try {
  const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('PAGE_TIMEOUT'));},timeoutMs);});
  return validatePage(await Promise.race([source.readPage(term,page,controller.signal),timeout]),page);
 } finally {if(timer)clearTimeout(timer);controller.abort();}
}

/** Advance at most one fenced unit. Merely importing this module or rendering
 * a page never starts recovery. A scheduler may call it only for a durably
 * authorized attempt and a confirmed dispatch. Unexpected responses or lost
 * commits are left for reconciliation; they are never retried here. */
export async function advanceHistoricalRecovery(input:{attemptId:string;lease:Lease;store:HistoricalStore;source:HistoricalSource;pageTimeoutMs?:number}) {
 const {attemptId,lease,store,source}=input;
 if(!attemptId||!lease.owner||!Number.isSafeInteger(lease.generation)||lease.generation<1)throw new Error('INVALID_LEASE');
 const pageTimeoutMs=input.pageTimeoutMs??15_000;
 if(!Number.isSafeInteger(pageTimeoutMs)||pageTimeoutMs<1||pageTimeoutMs>60_000)throw new Error('INVALID_TIMEOUT');
 let loaded:Awaited<ReturnType<HistoricalStore['read']>>;
 try {loaded=await store.read(attemptId,lease);} catch {return {status:'reconcile' as const,reason:'STATE_UNAVAILABLE'};}
 let action:SelectedAction;
 try {action=nextHistoricalAction(loaded.snapshot);} catch {return {status:'reconcile' as const,reason:'STATE_INVALID'};}
 if(action.kind==='finished')return {status:'completed' as const};
 if(action.kind==='reconcile')return {status:'reconcile' as const,reason:action.reason};
 let currentProgress:HistoricalProgress;
 try {currentProgress=progress(loaded.snapshot,action);} catch {return {status:'reconcile' as const,reason:'STATE_INVALID'};}
 const reservation:Reservation={id:createHash('sha256').update(JSON.stringify({attemptId,action})).digest('hex'),action,progress:currentProgress};
 let acquired:boolean;
 try {acquired=await store.begin(attemptId,lease,loaded.revision,reservation);}
 catch {return {status:'reconcile' as const,reason:'RESERVATION_UNCONFIRMED'};}
 if(acquired!==true)return {status:'yield' as const,reason:'STATE_CHANGED'};
 try {
  let result:{page?:HistoricalPage;pageHash?:string}={};
  if(action.kind==='fetch_page'){
   const page=await readPage(source,action.term,action.page,pageTimeoutMs);
   result={page,pageHash:historicalCanonicalHash(page)};
  }
  await store.apply(attemptId,lease,reservation,result);
  return {status:'advanced' as const,action:action.kind,progress:currentProgress};
 } catch {return {status:'reconcile' as const,reason:'OPERATION_UNCONFIRMED'};}
}
