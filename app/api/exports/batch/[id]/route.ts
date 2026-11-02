import {ConveniIndependentReadUnavailable,independentConveniReadersEnabled,requireConsistentConveniReads} from '@/lib/convenis/independent-read-guard';
import { createHash, randomUUID } from "node:crypto";
import { hasUnitSchema } from "@/lib/runtime-schema";
import { readBatchExport } from "@/lib/batch-export-reader";
import { createServerSupabase } from "@/lib/records-page";
import { createProvisionExcel, type ProvisionExcelRow } from "@/lib/provision-excel";
import {ExcelCalendarDateError} from "@/lib/excel-calendar-date";
import {LineReadUnavailable,requireConsistentLineReads} from '@/lib/concerts/line-read-guard';

export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id))
    return Response.json(
      { error: "Identificador de lot no vàlid." },
      { status: 400 },
    );
  const supabase = createServerSupabase();
  try{await requireConsistentConveniReads(supabase);}catch(error){if(error instanceof ConveniIndependentReadUnavailable)return Response.json({error:error.message},{status:503});throw error;}
  const independent=independentConveniReadersEnabled();
  try{if(!independent)await requireConsistentLineReads(supabase);}catch(error){if(error instanceof LineReadUnavailable)return Response.json({error:error.message},{status:503});throw error;}
  const lineLedger=independent||(process.env.ENABLE_CONCERT_LINE_AWARDS==='true'&&process.env.CONCERT_LINE_READERS_READY==='true');
  const { data: run, error: runError } = await supabase
    .from("pipeline_runs")
    .select("id,batch_number,status")
    .eq("id", id)
    .maybeSingle();
  if (runError)
    return Response.json({ error: runError.message }, { status: 500 });
  if (!run)
    return Response.json({ error: "El lot no existeix." }, { status: 404 });
  if(lineLedger){
    const snapshotResult=await supabase.rpc(independent?'conveni_independent_batch_snapshot':'concert_line_batch_snapshot',{p_run:id});
    if(snapshotResult.error)return Response.json({error:'No s’ha pogut fixar l’estat del lot; torna-ho a provar.'},{status:409});
    const snapshot=snapshotResult.data as {sources:string[];provisions:Array<{id:string;snapshot:ProvisionExcelRow}>;pending:Array<{id:string;source_record_id:string}>};
    if(!snapshot?.sources?.length||!snapshot?.provisions?.length)return Response.json({error:"Cal validar humanament almenys un registre abans d'exportar el lot."},{status:409});
    const counts=new Map<string,number>();for(const unit of snapshot.pending)counts.set(unit.source_record_id,(counts.get(unit.source_record_id)??0)+1);
    const reviewWarnings=[...counts].sort(([a],[b])=>a.localeCompare(b)).map(([recordId,count])=>`Registro ${recordId}: ${count} líneas pendientes de revisión.`);
    try{
      const bytes=await createProvisionExcel(snapshot.provisions.map(row=>row.snapshot),{reviewWarnings});
      const stamp=new Date().toISOString().replace(/[:T]/g,'-').slice(0,16);const filename=`Detalle-Provisiones-Lot-${String(run.batch_number).padStart(8,'0')}-${stamp}.xlsx`;
      await requireConsistentConveniReads(supabase);
      const result=await supabase.rpc(independent?'conveni_independent_batch_commit':'concert_line_batch_snapshot_commit',{p_receipt:randomUUID(),p_run:id,p_filename:filename,p_hash:createHash('sha256').update(bytes).digest('hex'),p_expected:snapshot});
      if(result.error)return Response.json({error:'El lot ha canviat o s’està modificant; torna a generar l’exportació.'},{status:409});
      return new Response(Uint8Array.from(bytes).buffer,{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="${filename}"`,'Cache-Control':'no-store'}});
    }catch(error){return Response.json({error:error instanceof Error?error.message:String(error)},{status:error instanceof ConveniIndependentReadUnavailable?503:error instanceof ExcelCalendarDateError?422:500});}
  }
  let scope: Awaited<ReturnType<typeof readBatchExport>>;
  try { scope = await readBatchExport(supabase, id, hasUnitSchema()); }
  catch (error) {
    const message = error && typeof error === "object" && "message" in error ? String(error.message) : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
  if (!scope.recordIds.length)
    return Response.json(
      { error: "El lot no conté registres." },
      { status: 409 },
    );
  const data = scope.provisions;
  if (!data.length)
    return Response.json(
      { error: "Cal validar humanament almenys un registre abans d'exportar el lot." },
      { status: 409 },
    );

  const reviewWarnings: string[] = [];
  for (const [recordId, count] of [...scope.pendingCounts].sort(([a],[b]) => a.localeCompare(b))) reviewWarnings.push(`Registro ${recordId}: ${count} líneas pendientes de revisión.`);

  let bytes: Uint8Array;
  try { bytes = await createProvisionExcel((data ?? []).map((item) => ({ ...item, service_name: relationName(item.official_services ?? item.master_services) })) as unknown as ProvisionExcelRow[], { reviewWarnings }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: error instanceof ExcelCalendarDateError ? 422 : 500 }); }
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
  const batchNumber = String(run.batch_number).padStart(8, "0");
  const filename = `Detalle-Provisiones-Lot-${batchNumber}-${stamp}.xlsx`;
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  try{if(!independent)await requireConsistentLineReads(supabase);}catch(error){if(error instanceof LineReadUnavailable)return Response.json({error:error.message},{status:503});throw error;}
  try{await requireConsistentConveniReads(supabase);}catch(error){if(error instanceof ConveniIndependentReadUnavailable)return Response.json({error:error.message},{status:503});throw error;}
  const { data: exported, error: exportError } = await supabase.rpc("record_batch_export", {p_run:id,p_filename:filename,p_content_hash:contentHash,p_provisions:data.map(item=>item.id)});
  if (exportError) {
    if (exportError.code === "55P03")
      return Response.json({ error: "Les dades del lot s’estan modificant. Torna a generar l’exportació." }, { status: 409 });
    return Response.json({ error: exportError.message }, { status: exportError.code === "40001" ? 409 : 500 });
  }
  if (typeof exported !== "string")
    return Response.json({ error: "No s’ha pogut registrar l’exportació." }, { status: 500 });
  return new Response(Uint8Array.from(bytes).buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

function relationName(value: unknown) {
  const item = (Array.isArray(value) ? value[0] : value) as { service_name?: string } | null;
  return item?.service_name ?? "Servei no informat";
}
