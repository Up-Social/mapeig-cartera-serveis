import {createServerSupabase} from '@/lib/records-page';
import {handleIsolatedExport} from '@/lib/concerts/line-export-handler';

export async function POST(request:Request){
 if(process.env.ENABLE_CONCERT_LINE_AWARDS!=='true'||process.env.CONCERT_LINE_READERS_READY!=='true')return Response.json({error:'L’exportació de línies encara no està disponible.'},{status:503});
 const db=createServerSupabase();
 return handleIsolatedExport(request,{
  read:async(ids)=>{const result=await db.rpc('concert_line_export_snapshot',{p_ids:ids});if(result.error)throw result.error;return result.data;},
  commit:async(receipt,hash,rows)=>{const result=await db.rpc('concert_line_export_commit',{p_receipt:receipt,p_content_hash:hash,p_expected:rows});if(result.error)throw result.error;if(result.data!==receipt)throw Error('RECEIPT_MISMATCH');},
 });
}
