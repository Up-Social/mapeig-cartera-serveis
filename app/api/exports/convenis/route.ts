import {createServerSupabase} from '@/lib/records-page';
import {isUuid} from '@/lib/uuid';
import {readPages} from '@/lib/read-pages';
import {EXCLUSION_LABELS,normalizeConveni} from '@/lib/convenis/contract';
import {createConveniExcel,type ConveniExportRow} from '@/lib/convenis/export';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const params=new URL(request.url).searchParams;const record=params.get('record');const year=params.get('year');
 if((record&&!isUuid(record))||(year&&!/^\d{4}$/.test(year)))return Response.json({error:'Filtres invàlids'},{status:400});
 const db=createServerSupabase();
 try{
  const units=await readPages((from,to)=>{let q=db.from('conveni_current_units').select('*').order('unit_id').range(from,to);if(record)q=q.eq('source_record_id',record);return q;});
  const selected=units.filter(u=>u.outcome==='select'&&u.reviewed_job===u.job_id&&(!year||u.data.year===Number(year)));
  const provisions=selected.length?await readPages((from,to)=>db.from('conveni_reviewed_provisions').select('*,official_services(service_name),source_records(source_payload)').in('unit_id',selected.map(u=>u.unit_id)).is('superseded_at',null).order('id').range(from,to)):[];
  const byUnit=new Map(selected.map(u=>[u.unit_id,u]));
  const rows:ConveniExportRow[]=provisions.map(p=>{const u=byUnit.get(p.unit_id)!;const payload=p.source_records?.source_payload??{};const original=normalizeConveni(payload);return {...p,service_name:p.official_services?.service_name??'',data:u.data,instrument_grant:u.payload.instrument_grant,related:original.related,annexes:original.annexes.map(a=>a.url)};});
  if(!rows.length)return Response.json({error:'No hi ha unitats de conveni aprovades amb fonts vigents per a aquesta selecció.'},{status:409});
  const analyses=await readPages((from,to)=>{let q=db.from('conveni_current_analyses').select('source_record_id,exclusion_reason,payload').order('source_record_id').range(from,to);if(record)q=q.eq('source_record_id',record);return q;});
  const warnings=[`${rows.length} unitats exportades de ${units.length} unitats actuals. Les exclusions, pendents i anualitats fora del filtre no representen imports zero.`,...analyses.filter(a=>a.exclusion_reason).map(a=>`Conveni ${a.source_record_id}: exclòs (${EXCLUSION_LABELS[a.exclusion_reason]??a.exclusion_reason}).`),...analyses.filter(a=>a.payload.unallocated_cents>0).map(a=>`Conveni ${a.source_record_id}: romanent sense atribució de ${(a.payload.unallocated_cents/100).toFixed(2)} €. No s’ha exportat.`),...units.filter(u=>!provisions.some(p=>p.unit_id===u.unit_id)).map(u=>`Unitat exclosa ${u.unit_id}: ${u.data.recipient}, ${u.data.period}. ${u.outcome??'Pendent'}${u.data.blockers.length?'; '+u.data.blockers.join(', '):''}.`),...(year?[`Filtre d’anualitat: ${year}. Els imports sense desglossament anual no s’han imputat a aquest any.`]:[])];
  const legacy=params.get('format')==='legacy';const bytes=await createConveniExcel(rows,warnings,legacy);
  return new Response(Uint8Array.from(bytes).buffer,{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="${legacy?'Detalle_Provisiones':'Detall_Registres'}-Convenis.xlsx"`,'Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Error d’exportació'},{status:500});}
}
