import {randomUUID,createHash} from 'node:crypto';
import {createProvisionExcel,type ProvisionExcelRow} from '../provision-excel';

type FrozenProvision={id:string;snapshot:ProvisionExcelRow};
type Dependencies={read:(ids:string[])=>Promise<FrozenProvision[]>;commit:(receipt:string,hash:string,rows:FrozenProvision[])=>Promise<void>};
export async function handleMixedExport(request:Request,deps:Dependencies):Promise<Response>{
 const body=await request.json().catch(()=>null) as {provisionIds?:unknown;receipt?:unknown}|null;
 const raw=Array.isArray(body?.provisionIds)?body.provisionIds:[];
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 if(raw.length===0||raw.length>5000||raw.some(x=>typeof x!=='string'||!uuid.test(x))||new Set(raw).size!==raw.length||(body?.receipt!=null&&(typeof body.receipt!=='string'||!uuid.test(body.receipt))))return Response.json({error:'Selecciona entre 1 i 5.000 provisions vàlides.'},{status:400});
 const ids=raw as string[];const receipt=typeof body?.receipt==='string'?body.receipt:randomUUID();
 try{
  const rows=(await deps.read(ids)).sort((a,b)=>a.id.localeCompare(b.id));
  if(rows.length!==ids.length||new Set(rows.map(row=>row.id)).size!==ids.length||rows.some(row=>!ids.includes(row.id)))return Response.json({error:'La selecció ha canviat; torna-la a comprovar.'},{status:409});
  const bytes=await createProvisionExcel(rows.map(row=>row.snapshot));const hash=createHash('sha256').update(bytes).digest('hex');
  await deps.commit(receipt,hash,rows);
  return new Response(Uint8Array.from(bytes).buffer,{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="Provisions-aprovades.xlsx"','Cache-Control':'no-store','X-Receipt-Id':receipt}});
 }catch(error){const code=(error as {code?:string})?.code;return Response.json({error:code==='40001'?'La selecció o les fonts han canviat; torna a generar el fitxer.':'No s’ha pogut generar l’exportació.'},{status:code==='40001'?409:500});}
}
