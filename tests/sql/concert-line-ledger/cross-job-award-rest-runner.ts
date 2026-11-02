import {createHmac} from 'node:crypto';
import {handleAward,type AwardSnapshot} from '../../../lib/concerts/line-award-handler';

type Fixture={record:string;job:string;unit:string;event:string;previous:string;code:string;quote:string};
const input=JSON.parse(process.argv[2]) as Fixture;
const secret='private-synthetic-projection-secret-0000000000000000';
const enc=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');
function token(role:string){const header=enc({alg:'HS256',typ:'JWT'})+'.'+enc({role,exp:Math.floor(Date.now()/1000)+600});return header+'.'+createHmac('sha256',secret).update(header).digest('base64url');}
async function rpc(name:string,body:unknown,role='service_role'){
 const response=await fetch('http://127.0.0.1:3000/rpc/'+name,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token(role)},body:JSON.stringify(body)});
 const data=await response.json();if(!response.ok)throw Object.assign(Error('RPC_FAILED'),{status:response.status,data});return data;
}
const args={p_record:input.record,p_job:input.job,p_unit:input.unit};
const payload={jobId:input.job,eventId:input.event,previousId:input.previous,code:input.code,amountLiteral:'13.000,00',quote:input.quote,reason:'Revisió del nou treball',reviewer:'Revisor',award:true,recipient:true,allocation:true};
const ids=['dddddddd-dddd-4ddd-8ddd-dddddddddddd','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'];
function request(id:string){return new Request('http://fixture.invalid',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,decisionId:id})});}
let arrivals=0;let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
let released=false;const timeout=setTimeout(()=>{if(!released)release();},10000);
const deps={
 snapshot:async(record:string,job:string,unit:string)=>rpc('concert_line_award_archive_snapshot',{p_record:record,p_job:job,p_unit:unit}),
 // This older harness simulates byte verification and retention; its real SQL
 // checks concern the predecessor and concurrent decision contract only.
 capture:async(s:AwardSnapshot)=>{if(!s.document_path.startsWith('cases/')||!s.unit_path.startsWith('cases/')||s.document_sha256!=='a'.repeat(64))throw Error('MOCK_SOURCE_MISMATCH');return Buffer.from('synthetic fixture');},
 retain:async()=>{},
 decide:async(values:Record<string,unknown>)=>{arrivals++;if(arrivals===2){released=true;release();}await gate;return rpc('concert_line_award_decide',values);},
};
async function main(){
 try{await rpc('concert_line_award_archive_snapshot',args,'anon');throw Error('ANON_SNAPSHOT_ALLOWED');}catch(error){if(!(error instanceof Error)||!('status' in error))throw error;}
 const initial=await deps.snapshot(input.record,input.job,input.unit);
 if(initial.previous_decision!==input.previous||initial.population_event!==input.event)throw Error('PREDECESSOR_OR_EVENT_MISMATCH');
 try{
  await rpc('concert_line_award_decide',{p_record:input.record,p_job:input.job,p_unit:input.unit,p_decision:ids[0],p_population:input.event,p_code:input.code,p_amount_literal:'13.000,00',p_quote:input.quote,p_note:payload.reason,p_reviewer:payload.reviewer,p_confirmations:{award:true,recipient:true,allocation:true},p_source_object:initial.source_object,p_source_version:initial.source_version,p_item_object:initial.item_object,p_item_version:initial.item_version,p_previous:input.previous},'anon');
  throw Error('ANON_DECISION_ALLOWED');
 }catch(error){if(!(error instanceof Error)||!('status' in error))throw error;}
 const responses=await Promise.all(ids.map(id=>handleAward(request(id),input.record,input.unit,deps)));
 if(arrivals!==2||responses.filter(response=>response.status===200).length!==1||responses.filter(response=>response.status===409).length!==1)throw Error('CROSS_JOB_CAS_FAILURE '+responses.map(response=>response.status));
 const winner=ids[responses.findIndex(response=>response.status===200)];
 const replay=await handleAward(request(winner),input.record,input.unit,deps);
 if(replay.status!==200)throw Error('CROSS_JOB_REPLAY_FAILURE');
 process.stdout.write(JSON.stringify({winner,arrivals,statuses:responses.map(response=>response.status),replay:replay.status}));
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>clearTimeout(timeout));
