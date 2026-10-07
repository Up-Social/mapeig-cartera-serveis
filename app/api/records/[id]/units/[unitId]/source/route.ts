import {createServerSupabase} from '@/lib/records-page';
import {SOURCE_BUCKET,sha256} from '@/lib/source-storage';
import {isUuid} from '@/lib/uuid';

export async function GET(_request:Request,{params}:{params:Promise<{id:string;unitId:string}>}){
 const {id,unitId}=await params;
 if(!isUuid(id)||!isUuid(unitId))return Response.json({error:'Identificador no vàlid'},{status:400});
 const db=createServerSupabase();
 const unit=await db.from('record_units').select('storage_path,storage_sha256,document_id').eq('id',unitId).eq('source_record_id',id).maybeSingle();
 if(unit.error||!unit.data?.storage_path||!unit.data.document_id||!unit.data.storage_sha256)return Response.json({error:'Font arxivada no disponible'},{status:404});
 const prefix=`cases/${id}/items/${unitId}/documents/${unit.data.document_id}/${unit.data.storage_sha256}.`;
 if(!/^[a-f0-9]{64}$/.test(unit.data.storage_sha256)||!unit.data.storage_path.startsWith(prefix)||!/^[a-z0-9]+$/.test(unit.data.storage_path.slice(prefix.length)))
  return Response.json({error:'Ruta de la còpia arxivada invàlida'},{status:503});
 const doc=await db.from('source_documents').select('mime_type').eq('id',unit.data.document_id).eq('source_record_id',id).maybeSingle();
 if(doc.error||!doc.data)return Response.json({error:'Document no disponible'},{status:404});
 const stored=await db.storage.from(SOURCE_BUCKET).download(unit.data.storage_path);
 if(stored.error||!stored.data)return Response.json({error:'Còpia absent de Storage'},{status:503});
 const bytes=Buffer.from(await stored.data.arrayBuffer());
 if(sha256(bytes)!==unit.data.storage_sha256)return Response.json({error:'La còpia no supera la verificació d’integritat'},{status:503});
 const mime=doc.data.mime_type??'application/octet-stream';
 const headers=new Headers({'Content-Type':mime,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
 if(/html|xml|svg/i.test(mime))headers.set('Content-Security-Policy',"sandbox; default-src 'none'");
 return new Response(bytes,{headers});
}
