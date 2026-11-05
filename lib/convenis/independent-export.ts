import {conveniInstrumentsGrant} from './marks';
import {createHash,randomUUID} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import {EXCLUSION_LABELS,normalizeConveni,type ConveniUnit,type Payload} from './contract';
import {createConveniExcel,type ConveniExportRow} from './export';
import {ConveniIndependentReadUnavailable,requireConsistentConveniReads} from './independent-read-guard';

type Unit={unit_id:string;job_id:string;reviewed_job:string|null;outcome:string|null;data:ConveniUnit;payload:{instrument_grant:boolean}};
type Analysis={source_record_id:string;exclusion_reason:string|null;payload:{unallocated_cents:number}};
type Snapshot={record_id:string;year:number|null;source_payload:Payload|null;units:Unit[];provisions:Array<Omit<ConveniExportRow,'data'|'instrument_grant'|'related'|'annexes'>>;analyses:Analysis[]};
/** Render only from the fixed server snapshot and finalize before returning bytes. */
export async function independentConveniExport(db:SupabaseClient,record:string|null,year:string|null,legacy:boolean):Promise<Response>{
 try{
  const yearNumber=year===null?null:Number(year);
  const result=record?await db.rpc('conveni_independent_record_snapshot',{p_record:record,p_year:yearNumber}):await db.rpc('conveni_independent_global_snapshot',{p_year:yearNumber});if(result.error)throw result.error;
  const snapshot=result.data as Snapshot|{year:number|null;records:Snapshot[]}|null;
  if(!snapshot||snapshot.year!==yearNumber)throw Error('CONVENI_SNAPSHOT_INVALID');
  const records=record?[snapshot as Snapshot]:('records' in snapshot&&Array.isArray(snapshot.records)?snapshot.records:null);
  if(!records||records.some(s=>!s.source_payload||!Array.isArray(s.units)||!Array.isArray(s.provisions)||!Array.isArray(s.analyses)||(record!==null&&s.record_id!==record)))throw Error('CONVENI_SNAPSHOT_INVALID');
  const rows:ConveniExportRow[]=[],warnings:string[]=[];let totalUnits=0;
  for(const snap of records){
   const selected=new Map(snap.units.filter(u=>u.outcome==='select'&&u.reviewed_job===u.job_id).map(u=>[u.unit_id,u]));
   const original=normalizeConveni(snap.source_payload!);totalUnits+=snap.units.length;
   rows.push(...snap.provisions.map(p=>{const unit=selected.get(p.unit_id??'');if(!unit)throw Error('CONVENI_SNAPSHOT_SCOPE');return {...p,data:unit.data,instrument_grant:conveniInstrumentsGrant(snap.source_payload!,unit.payload.instrument_grant),related:original.related,annexes:original.annexes.map(a=>a.url)};}));
   warnings.push(...snap.analyses.filter(a=>a.exclusion_reason).map(a=>`Conveni ${a.source_record_id}: exclòs (${EXCLUSION_LABELS[a.exclusion_reason!]??a.exclusion_reason}).`),...snap.analyses.filter(a=>a.payload.unallocated_cents>0).map(a=>`Conveni ${a.source_record_id}: romanent sense atribució de ${(a.payload.unallocated_cents/100).toFixed(2)} €. No s’ha exportat.`),...snap.units.filter(u=>!snap.provisions.some(p=>p.unit_id===u.unit_id)).map(u=>`Unitat no exportada ${u.unit_id}: ${u.data.recipient}, ${u.data.period}. ${u.outcome??'Pendent'}${u.data.blockers.length?'; '+u.data.blockers.join(', '):''}.`));
  }
  if(!rows.length)return Response.json({error:'No hi ha unitats de conveni aprovades amb fonts vigents per a aquesta selecció.'},{status:409});
  warnings.unshift(`${rows.length} unitats exportades de ${totalUnits} unitats actuals. Les exclusions, pendents i anualitats fora del filtre no representen imports zero.`);
  if(year)warnings.push(`Filtre d’anualitat: ${year}. Els imports sense desglossament anual no s’han imputat a aquest any.`);
  const bytes=await createConveniExcel(rows,warnings,legacy);await requireConsistentConveniReads(db);
  const event=randomUUID(),hash=createHash('sha256').update(bytes).digest('hex');
  const saved=record?await db.rpc('conveni_independent_record_commit',{p_event:event,p_record:record,p_year:yearNumber,p_snapshot:snapshot,p_hash:hash}):await db.rpc('conveni_independent_global_commit',{p_event:event,p_year:yearNumber,p_snapshot:snapshot,p_hash:hash});
  if(saved.error){if(saved.error.code==='40001'||saved.error.code==='55P03')return Response.json({error:'Les dades han canviat; torna a generar l’exportació.'},{status:409});throw saved.error;}
  if(saved.data!==event)throw Error('CONVENI_RECEIPT_MISMATCH');
  return new Response(Uint8Array.from(bytes).buffer,{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="${legacy?'Detalle_Provisiones':'Detall_Registres'}-Convenis.xlsx"`,'Cache-Control':'no-store'}});
 }catch(error){return Response.json({error:error instanceof ConveniIndependentReadUnavailable?error.message:'No s’ha pogut generar l’exportació.'},{status:error instanceof ConveniIndependentReadUnavailable?503:500});}
}
