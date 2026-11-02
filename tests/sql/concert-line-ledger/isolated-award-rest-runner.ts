import {createHash,createHmac} from 'node:crypto';import {handleAward} from '../../../lib/concerts/line-award-handler';
const input=JSON.parse(process.argv[2]) as {record:string;job:string;unit:string;event:string;code:string;quote:string};const secret='private-synthetic-projection-secret-0000000000000000';
const enc=(x:unknown)=>Buffer.from(JSON.stringify(x)).toString('base64url');const p=enc({alg:'HS256',typ:'JWT'})+'.'+enc({role:'service_role',exp:Math.floor(Date.now()/1000)+600});const token=p+'.'+createHmac('sha256',secret).update(p).digest('base64url');
async function rpc(name:string,body:unknown){const r=await fetch('http://127.0.0.1:3000/rpc/'+name,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify(body)});const text=await r.text();const data=text?JSON.parse(text):null;if(!r.ok)throw data;return data;}
const decision='99999999-9999-4999-8999-999999999999';const payload={jobId:input.job,eventId:input.event,decisionId:decision,code:input.code,amountLiteral:'12.000,00',quote:input.quote,reason:'Confirmació humana sintètica',reviewer:'Revisor',award:true,recipient:true,allocation:true};
function req(value:unknown){return new Request('http://fixture.invalid',{method:'POST',body:JSON.stringify(value)});}
let corrupt=false;const deps={snapshot:async(record:string,job:string,unit:string)=>rpc('concert_line_award_archive_snapshot',{p_record:record,p_job:job,p_unit:unit}),verify:async(_path:string,sha:string)=>{const bytes=Buffer.from(corrupt?'bad':'Synthetic archived PDF');if(createHash('sha256').update(bytes).digest('hex')!==sha)throw Error('CORRUPT');},decide:async(values:Record<string,unknown>)=>rpc('concert_line_award_decide',values)};
async function main(){corrupt=true;if((await handleAward(req(payload),input.record,input.unit,deps)).status!==409)throw Error('BAD_BYTES_ACCEPTED');corrupt=false;
if((await handleAward(req({...payload,recipient:false}),input.record,input.unit,deps)).status!==400)throw Error('CONFIRMATION_ACCEPTED');
const first=await handleAward(req(payload),input.record,input.unit,deps);if(first.status!==200)throw Error('AWARD_FAILED '+await first.text());const replay=await handleAward(req(payload),input.record,input.unit,deps);if(replay.status!==200)throw Error('REPLAY_FAILED '+await replay.text());
const changed=await handleAward(req({...payload,reason:'Canvi de justificació'}),input.record,input.unit,deps);if(changed.status!==409)throw Error('CHANGED_REPLAY_ACCEPTED');
const racing={...deps,decide:async(values:Record<string,unknown>)=>{await rpc('test_change_item_version',{p_id:values.p_item_object});return rpc('concert_line_award_decide',values);}};
if((await handleAward(req(payload),input.record,input.unit,racing)).status!==409)throw Error('CHANGED_OBJECT_VERSION_ACCEPTED');
const current=await deps.snapshot(input.record,input.job,input.unit);await rpc('test_archive_item',{p_id:current.item_object});
if(await deps.snapshot(input.record,input.job,input.unit)!==null)throw Error('ARCHIVED_OBJECT_VISIBLE');
process.stdout.write('PASS award handler, PostgREST SQL, synthetic bytes, confirmations, replay and changed object version');}
main().catch(error=>{console.error(error);process.exitCode=1});
