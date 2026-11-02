import {createHmac,createHash} from 'node:crypto';
import {handleIsolatedExport} from '../../../lib/concerts/line-export-handler';
import {handleMixedExport} from '../../../lib/concerts/mixed-export-handler';
import {GET as batchGET} from '../../../app/api/exports/batch/[id]/route';
import {GET as masterGET} from '../../../app/api/exports/master/route';
import {POST as approvedPOST} from '../../../app/api/exports/approved/route';
import ExcelJS from 'exceljs';
const ids=JSON.parse(process.argv[2]) as string[];const secret='private-synthetic-projection-secret-0000000000000000';
const enc=(x:unknown)=>Buffer.from(JSON.stringify(x)).toString('base64url');
function jwt(role:string){const p=enc({alg:'HS256',typ:'JWT'})+'.'+enc({role,exp:Math.floor(Date.now()/1000)+600});return p+'.'+createHmac('sha256',secret).update(p).digest('base64url');}
async function rpc(name:string,body:unknown,role='service_role'){
 const r=await fetch('http://127.0.0.1:3000/rpc/'+name,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+jwt(role)},body:JSON.stringify(body)});
 const data=await r.json();if(!r.ok)throw data;return data;
}
async function main(){
 let anonBlocked=false;try{await rpc('concert_line_export_snapshot',{p_ids:ids},'anon');}catch{anonBlocked=true;}if(!anonBlocked)throw new Error('ANON_RPC_ALLOWED');
 let authBlocked=false;try{await rpc('concert_line_export_snapshot',{p_ids:ids},'authenticated');}catch{authBlocked=true;}if(!authBlocked)throw new Error('AUTH_RPC_ALLOWED');
 const direct=await fetch('http://127.0.0.1:3000/concert_line_awards',{headers:{authorization:'Bearer '+jwt('service_role')}});if(direct.ok)throw new Error('DIRECT_TABLE_ALLOWED');
 const q=new URL('http://127.0.0.1:3000/rpc/concert_line_combined_provisions');q.searchParams.set('select','id,unit_id,amount,target_population,service_code,source_records!inner(financing_type),official_services(service_name),master_services(service_name)');q.searchParams.set('id','in.('+ids.join(',')+')');
 // The selection uses decision IDs elsewhere; resolve provision IDs via the snapshot.
 const snapshot=await rpc('concert_line_export_snapshot',{p_ids:ids});
 q.searchParams.set('id','in.('+snapshot.map((x:{snapshot:{id:string}})=>x.snapshot.id).join(',')+')');
 const embedded=await fetch(q,{headers:{authorization:'Bearer '+jwt('service_role')}});const embeddedBody=await embedded.json();
 if(!embedded.ok||embeddedBody.length!==2||embeddedBody.reduce((a:number,x:{amount:number})=>a+Number(x.amount),0)!==25000)throw new Error('COMPOSITE_EMBEDDING_FAILED '+JSON.stringify(embeddedBody));
 const listUrl=new URL('http://127.0.0.1:3000/rpc/concert_line_combined_approved');listUrl.searchParams.set('select','id,amount,concert_line_approved,source_records!inner(financing_type),official_services(service_name),master_services(service_name)');listUrl.searchParams.set('id',q.searchParams.get('id')!);
 const listResponse=await fetch(listUrl,{headers:{authorization:'Bearer '+jwt('service_role')}});const listRows=await listResponse.json();if(!listResponse.ok||listRows.length!==2||!listRows.every((x:{concert_line_approved:boolean})=>x.concert_line_approved))throw new Error('LISTING_FAILED '+JSON.stringify(listRows));
 let receipt='';let digest='';
 const req=new Request('http://fixture.invalid/',{method:'POST',body:JSON.stringify({ids})});
 const result=await handleIsolatedExport(req,{
  read:async selected=>await rpc('concert_line_export_snapshot',{p_ids:selected}),
  commit:async(id,hash,rows)=>{receipt=id;digest=hash;await rpc('concert_line_export_commit',{p_receipt:id,p_content_hash:hash,p_expected:rows});},
 });
 if(result.status!==200)throw new Error('HANDLER_FAILED '+await result.text());
 const bytes=Buffer.from(await result.arrayBuffer());if(createHash('sha256').update(bytes).digest('hex')!==digest)throw new Error('HASH_MISMATCH');
 const bad=await handleIsolatedExport(new Request('http://fixture.invalid/',{method:'POST',body:JSON.stringify({ids})}),{
  read:async selected=>await rpc('concert_line_export_snapshot',{p_ids:selected}),
  commit:async(id,hash,rows)=>{rows[0].snapshot.amount=999;await rpc('concert_line_export_commit',{p_receipt:id,p_content_hash:hash,p_expected:rows});},
 });
 if(bad.status!==409)throw new Error('STALE_NOT_REJECTED '+bad.status);
 const mixedIds=[...snapshot.map((x:{snapshot:{id:string}})=>x.snapshot.id),process.argv[3]];
 process.env.ENABLE_CONCERT_LINE_AWARDS='true';process.env.CONCERT_LINE_READERS_READY='true';process.env.TEST_SYNTHETIC_JWT=jwt('service_role');
 let mixedHash='';const mixedRequest=()=>new Request('http://fixture.invalid/',{method:'POST',body:JSON.stringify({provisionIds:mixedIds})});
 const mixed=await approvedPOST(mixedRequest());if(mixed.status!==200)throw new Error('MIXED_EXPORT_FAILED '+await mixed.text());const mixedBytes=Buffer.from(await mixed.arrayBuffer());mixedHash=createHash('sha256').update(mixedBytes).digest('hex');if(!mixedHash||!mixed.headers.get('X-Receipt-Id'))throw new Error('MIXED_HASH_MISSING');
 const batch=await batchGET(new Request('http://fixture.invalid/'),{params:Promise.resolve({id:process.argv[4]})});
 if(batch.status!==200)throw new Error('BATCH_ROUTE_FAILED '+await batch.text());
 const batchBytes=Buffer.from(await batch.arrayBuffer());if(!batchBytes.length)throw new Error('BATCH_EMPTY');
 const batchHash=createHash('sha256').update(batchBytes).digest('hex');const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(batchBytes as never);const sheet=workbook.getWorksheet('Detalle_Provisiones');if(!sheet||Number(sheet.getRow(2).getCell(8).value)+Number(sheet.getRow(3).getCell(8).value)!==25000)throw new Error('BATCH_AMOUNT_WRONG');
 const template=new ExcelJS.Workbook();template.addWorksheet('Detalle_Provisiones');template.addWorksheet('Tabla (resumen)').getCell('A4').value='1.1.1';await template.xlsx.writeFile('/tmp/fixture-master.xlsx');process.env.MASTER_EXCEL_PATH='/tmp/fixture-master.xlsx';
 const master=await masterGET();if(master.status!==200)throw new Error('MASTER_ROUTE_FAILED '+await master.text());const masterBytes=Buffer.from(await master.arrayBuffer());const masterHash=createHash('sha256').update(masterBytes).digest('hex');const masterBook=new ExcelJS.Workbook();await masterBook.xlsx.load(masterBytes as never);const masterSheet=masterBook.getWorksheet('Detalle_Provisiones');if(!masterSheet||[2,3,4].reduce((total,row)=>total+Number(masterSheet.getRow(row).getCell(8).value),0)!==50000)throw new Error('MASTER_AMOUNT_WRONG');if(![2,3,4].every(row=>String(masterSheet.getRow(row).getCell(13).value??'').length>0))throw new Error('MASTER_NAME_MISSING');
 const mixedStale=await handleMixedExport(mixedRequest(),{read:async selected=>rpc('concert_line_mixed_snapshot',{p_ids:selected}),commit:async(id,hash,rows)=>{rows[0].snapshot.amount=999;await rpc('concert_line_mixed_commit',{p_receipt:id,p_hash:hash,p_expected:rows});}});
 if(mixedStale.status!==409)throw new Error('MIXED_STALE_FAILED');
 process.env.ENABLE_CONCERT_LINE_AWARDS='false';
 if((await approvedPOST(mixedRequest())).status!==503)throw new Error('DISABLED_APPROVED_NOT_BLOCKED');
 if((await batchGET(new Request('http://fixture.invalid/'),{params:Promise.resolve({id:process.argv[4]})})).status!==503)throw new Error('DISABLED_BATCH_NOT_BLOCKED');
 if((await masterGET()).status!==503)throw new Error('DISABLED_MASTER_NOT_BLOCKED');
 process.stdout.write(JSON.stringify({receipt,digest,mixedHash,batchHash,masterHash,status:result.status,stale:bad.status,anonBlocked,authBlocked}));
}
main().catch(e=>{console.error(e);process.exitCode=1});
