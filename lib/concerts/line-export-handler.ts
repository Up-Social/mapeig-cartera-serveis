import {randomUUID} from 'node:crypto';
import {exportFrozenLines, type FrozenLine} from './line-export';

type Dependencies = {
  read: (ids:string[])=>Promise<FrozenLine[]>;
  commit: (receipt:string,hash:string,rows:FrozenLine[])=>Promise<void>;
};
// Caller must enforce the same authentication as exports.
export async function handleIsolatedExport(request:Request,deps:Dependencies):Promise<Response> {
  const body=await request.json().catch(()=>null) as {ids?:unknown;receipt?:unknown}|null;
  const ids=Array.isArray(body?.ids) ? body.ids : [];
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if(ids.length===0||ids.length>1000||ids.some(x=>typeof x!=='string'||!uuid.test(x))||new Set(ids).size!==ids.length || (body?.receipt!=null&&(typeof body.receipt!=='string'||!uuid.test(body.receipt)))) return Response.json({error:'Selecció invàlida'}, {status:400});
  const receipt=typeof body?.receipt==='string'?body.receipt:randomUUID();
  try{
    const lines=await deps.read(ids as string[]);
    if(lines.length!==ids.length||new Set(lines.map(x=>x.decision_id)).size!==ids.length||lines.some(x=>!ids.includes(x.decision_id)))return Response.json({error:'La selecció ha canviat'}, {status:409});
    const result=await exportFrozenLines(lines,(hash,rows)=>deps.commit(receipt,hash,rows));
    return new Response(Uint8Array.from(result.bytes).buffer,{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Cache-Control':'no-store','X-Receipt-Id':receipt}});
  }catch(error){
    const code=(error as {code?:string})?.code;
    return Response.json({error:code==='40001'?'La documentació ha canviat; torna a generar el fitxer.':'No s’ha pogut generar el fitxer.'},{status:code==='40001'?409:500});
  }
}
