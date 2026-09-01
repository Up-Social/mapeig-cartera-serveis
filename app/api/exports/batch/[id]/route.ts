import { createHash } from "node:crypto";
import { createServerSupabase } from "@/lib/records-page";
import { createProvisionExcel, type ProvisionExcelRow } from "@/lib/provision-excel";

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
  const { data: run, error: runError } = await supabase
    .from("pipeline_runs")
    .select("id,batch_number,status,pipeline_jobs(source_record_id,status)")
    .eq("id", id)
    .maybeSingle();
  if (runError)
    return Response.json({ error: runError.message }, { status: 500 });
  if (!run)
    return Response.json({ error: "El lot no existeix." }, { status: 404 });
  const jobs = Array.isArray(run.pipeline_jobs) ? run.pipeline_jobs : [];
  if (!jobs.length)
    return Response.json(
      { error: "El lot no conté registres." },
      { status: 409 },
    );
  const recordIds = jobs.map((job) => job.source_record_id);
  const { data, error } = await supabase
    .from("service_provisions")
    .select(
      "id,source_id,call_url,regulatory_basis_url,provider_name,provider_nif,mechanism,award_date,amount,contracting_body,target_population,source_reference,service_code,master_services(service_name)",
    )
    .in("source_record_id", recordIds)
    .order("created_at");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data?.length)
    return Response.json(
      { error: "Cal validar humanament almenys un registre abans d'exportar el lot." },
      { status: 409 },
    );

  let bytes: Uint8Array;
  try { bytes = await createProvisionExcel((data ?? []).map((item) => ({ ...item, service_name: relationName(item.master_services) })) as unknown as ProvisionExcelRow[]); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 }); }
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
  const batchNumber = String(run.batch_number).padStart(8, "0");
  const filename = `Detalle-Provisiones-Lot-${batchNumber}-${stamp}.xlsx`;
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  const { data: exported, error: exportError } = await supabase.from("excel_exports").insert({
    pipeline_run_id: id,
    filename,
    provision_count: data?.length ?? 0,
    content_hash: contentHash,
  }).select("id").single();
  if (exportError)
    return Response.json({ error: exportError.message }, { status: 500 });
  const { error: itemError } = await supabase.from("excel_export_items").insert(data.map((item) => ({ export_id: exported.id, provision_id: item.id })));
  if (itemError) return Response.json({ error: itemError.message }, { status: 500 });
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
