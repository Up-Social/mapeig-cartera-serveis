import "server-only";
import { createServerSupabase } from "./records-page";
import type { ApprovedFilters, ApprovedPage, ApprovedProvision } from "./approved-types";

const PAGE_SIZE = 50;
const SELECT = "id,source_record_id,source_id,call_url,regulatory_basis_url,provider_name,provider_nif,mechanism,award_date,amount,contracting_body,target_population,source_reference,service_code,approved_at,source_records!inner(id,title,source_dataset,financing_type,source_record_id,processing_status,review_decisions(decision,created_at),pipeline_jobs(run_id,status,created_at,pipeline_runs(batch_number))),master_services(service_name)";

export async function getApprovedPage(filters: ApprovedFilters): Promise<ApprovedPage> {
  const db = createServerSupabase();
  let request = db.from("service_provisions").select(SELECT, { count: "exact" }).eq("source_records.processing_status", "completat");
  let allIdsRequest = db.from("service_provisions").select("id,source_records!inner(processing_status,financing_type)").eq("source_records.processing_status", "completat");
  if (filters.type !== "totes") { request = request.eq("source_records.financing_type", filters.type); allIdsRequest = allIdsRequest.eq("source_records.financing_type", filters.type); }
  if (filters.query) { const q = filters.query.replaceAll(/[,%()]/g, " ").trim(); const expression = `provider_name.ilike.%${q}%,provider_nif.ilike.%${q}%,source_id.ilike.%${q}%,service_code.ilike.%${q}%`; request = request.or(expression); allIdsRequest = allIdsRequest.or(expression); }
  const from = (filters.page - 1) * PAGE_SIZE;
  const [result, allIdsResult] = await Promise.all([
    request.order("approved_at", { ascending: false }).range(from, from + PAGE_SIZE - 1),
    allIdsRequest.order("approved_at", { ascending: false }).range(0, 4999),
  ]);
  if (result.error) throw result.error;
  if (allIdsResult.error) throw allIdsResult.error;
  const total = result.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return { provisions: (result.data ?? []).map(mapApproved), allProvisionIds: (allIdsResult.data ?? []).map((item) => String(item.id)), total, page: Math.min(filters.page, pageCount), pageCount, pageSize: PAGE_SIZE };
}

function mapApproved(row: Record<string, unknown>): ApprovedProvision {
  const rawSource = row.source_records; const source = (Array.isArray(rawSource) ? rawSource[0] : rawSource) as Record<string, unknown>;
  const jobs = Array.isArray(source.pipeline_jobs) ? source.pipeline_jobs as Array<Record<string, unknown>> : [];
  const job = jobs.filter((item) => ["approved", "corrected"].includes(String(item.status))).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
  const rawRun = job && (Array.isArray(job.pipeline_runs) ? job.pipeline_runs[0] : job.pipeline_runs); const run = rawRun as Record<string, unknown> | undefined;
  const decisions = Array.isArray(source.review_decisions) ? source.review_decisions as Array<Record<string, unknown>> : [];
  const decision = decisions.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
  const rawMaster = row.master_services; const master = (Array.isArray(rawMaster) ? rawMaster[0] : rawMaster) as Record<string, unknown> | undefined;
  return { id: String(row.id), sourceRecordId: String(row.source_record_id), sourceId: String(row.source_id), title: String(source.title), sourceDataset: String(source.source_dataset), financingType: String(source.financing_type), batchId: job ? String(job.run_id) : null, batchNumber: run?.batch_number == null ? null : String(run.batch_number).padStart(8, "0"), decision: (decision?.decision === "corrected" ? "corrected" : "approved"), decisionDate: decision?.created_at == null ? null : String(decision.created_at), serviceCode: String(row.service_code), serviceName: String(master?.service_name ?? row.service_code), providerName: row.provider_name == null ? null : String(row.provider_name), providerNif: row.provider_nif == null ? null : String(row.provider_nif), mechanism: String(row.mechanism), awardDate: row.award_date == null ? null : String(row.award_date), amount: row.amount == null ? null : Number(row.amount), contractingBody: row.contracting_body == null ? null : String(row.contracting_body), targetPopulation: row.target_population == null ? null : String(row.target_population), callUrl: row.call_url == null ? null : String(row.call_url), regulatoryBasisUrl: row.regulatory_basis_url == null ? null : String(row.regulatory_basis_url), sourceReference: String(row.source_reference) };
}
