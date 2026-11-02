import {ConveniIndependentReadUnavailable,independentConveniReadersEnabled,requireConsistentConveniReads} from '@/lib/convenis/independent-read-guard';
import { createHash } from "node:crypto";
import { hasUnitSchema, schemaSelect, type ExportProvision } from "@/lib/runtime-schema";
import { createServerSupabase } from "@/lib/records-page";
import { createProvisionExcel, type ProvisionExcelRow } from "@/lib/provision-excel";
import {ExcelCalendarDateError} from "@/lib/excel-calendar-date";
import {handleMixedExport} from '@/lib/concerts/mixed-export-handler';
import {LineReadUnavailable,requireConsistentLineReads} from '@/lib/concerts/line-read-guard';

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const gateDb=createServerSupabase();
  try{await requireConsistentConveniReads(gateDb);}catch(error){if(error instanceof ConveniIndependentReadUnavailable)return Response.json({error:error.message},{status:503});throw error;}
  if(independentConveniReadersEnabled()){
    return handleMixedExport(request,{
      read:async(ids)=>{const result=await gateDb.rpc('conveni_independent_mixed_snapshot',{p_ids:ids});if(result.error)throw result.error;return result.data;},
      commit:async(receipt,hash,rows)=>{await requireConsistentConveniReads(gateDb);const result=await gateDb.rpc('conveni_independent_mixed_commit',{p_receipt:receipt,p_hash:hash,p_expected:rows});if(result.error)throw result.error;if(result.data!==receipt)throw Error('RECEIPT_MISMATCH');},
    });
  }
  if(process.env.ENABLE_CONCERT_LINE_AWARDS==='true'&&process.env.CONCERT_LINE_READERS_READY==='true'){
    const db=createServerSupabase();
    return handleMixedExport(request,{
      read:async(ids)=>{const result=await db.rpc('concert_line_mixed_snapshot',{p_ids:ids});if(result.error)throw result.error;return result.data;},
      commit:async(receipt,hash,rows)=>{await requireConsistentConveniReads(db);const result=await db.rpc('concert_line_mixed_commit',{p_receipt:receipt,p_hash:hash,p_expected:rows});if(result.error)throw result.error;if(result.data!==receipt)throw Error('RECEIPT_MISMATCH');},
    });
  }
  const body = await request.json().catch(() => null) as { provisionIds?: unknown } | null;
  const ids = Array.isArray(body?.provisionIds) ? [...new Set(body.provisionIds.filter((id): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)))] : [];
  if (!ids.length || ids.length > 5000) return Response.json({ error: "Selecciona entre 1 i 5.000 provisions vàlides." }, { status: 400 });
  const db = createServerSupabase();
  try{await requireConsistentLineReads(db);}catch(error){if(error instanceof LineReadUnavailable)return Response.json({error:error.message},{status:503});throw error;}
  let query = db.from("conveni_reviewed_provisions").select(schemaSelect("id,source_record_id,source_id,unit_id,centre,period,act_type,annex_reference,call_url,regulatory_basis_url,provider_name,provider_nif,mechanism,award_date,amount,contracting_body,target_population,source_reference,service_code,master_services(service_name),official_services(service_name),source_records!inner(financing_type,processing_status,review_decisions(decision,created_at),pipeline_jobs(status,created_at,pipeline_runs(batch_number)))")).in("id", ids);
  if (hasUnitSchema()) query = query.is("superseded_at", null);
  const result = await query.returns<ExportProvision[]>();
  if (result.error) return Response.json({ error: result.error.message }, { status: 500 });
  if ((result.data ?? []).length !== ids.length) return Response.json({ error: "Alguna provisió ja no existeix o no és accessible." }, { status: 409 });
  const valid = (result.data ?? []).filter((item) => { const raw = item.source_records; const source = (Array.isArray(raw) ? raw[0] : raw) as { processing_status?: string; review_decisions?: Array<{ decision: string; created_at: string }> }; const latest = [...(source?.review_decisions ?? [])].sort((a,b) => b.created_at.localeCompare(a.created_at))[0]; return item.mechanism==='Conveni'||source?.processing_status === "completat" && ["approved","corrected"].includes(latest?.decision); });
  if (valid.length !== ids.length) return Response.json({ error: "La selecció conté una provisió que ja no està aprovada." }, { status: 409 });
  valid.sort((a, b) => String(a.source_id).localeCompare(String(b.source_id), "ca"));
  try {
    const rows = valid.map((item) => { const raw = item.official_services ?? item.master_services; const master = (Array.isArray(raw) ? raw[0] : raw) as { service_name?: string } | null; return { ...item, service_name: master?.service_name ?? "Servei no informat" }; });
    const bytes = await createProvisionExcel(rows as unknown as ProvisionExcelRow[]); const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16); const filename = `Detalle-Provisiones-Aprovats-${stamp}.xlsx`;
    await requireConsistentLineReads(db);await requireConsistentConveniReads(db);
    const exported = await db.from("excel_exports").insert({ pipeline_run_id: null, filename, provision_count: valid.length, content_hash: createHash("sha256").update(bytes).digest("hex") }).select("id").single(); if (exported.error) throw exported.error;
    const items = await db.from("excel_export_items").insert(valid.map((item) => ({ export_id: exported.data.id, provision_id: item.id }))); if (items.error) throw items.error;
    return new Response(Uint8Array.from(bytes).buffer, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: error instanceof LineReadUnavailable || error instanceof ConveniIndependentReadUnavailable ? 503 : error instanceof ExcelCalendarDateError ? 422 : 500 }); }
}
