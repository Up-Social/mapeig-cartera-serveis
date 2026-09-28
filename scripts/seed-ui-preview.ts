import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { runMockWorkflow } from "../lib/mock-workflow";
import { assertTestEnvironment, TEST_API, TEST_PROJECT } from "../lib/test-environment";

const records = [
  ["71000000-0000-4000-8000-000000000001", "UI-PREVIEW-REVIEW", "Servei fictici pendent de revisió", "in_portfolio"],
  ["71000000-0000-4000-8000-000000000002", "UI-PREVIEW-DISCARDED", "Ajut individual fictici descartat", "discarded"],
  ["71000000-0000-4000-8000-000000000003", "UI-PREVIEW-OUTSIDE", "Actuació fictícia fora de cartera", "out_of_portfolio"],
  ["71000000-0000-4000-8000-000000000004", "UI-PREVIEW-ISSUE", "Cas fictici amb evidència insuficient", "insufficient_evidence"],
  ["71000000-0000-4000-8000-000000000005", "UI-PREVIEW-APPROVED", "Servei fictici aprovat", "in_portfolio"],
] as const;

async function main() {
  const status = JSON.parse(execFileSync("supabase", ["status", "--workdir", "tests/runtime", "-o", "json"], { encoding: "utf8" }));
  Object.assign(process.env, { NEXT_PUBLIC_SUPABASE_URL: status.API_URL, WORKFLOW_TEST_PROJECT: TEST_PROJECT, PIPELINE_PROVIDER: "mock", OPENAI_API_KEY: "", VERCEL_TOKEN: "", SUPABASE_ACCESS_TOKEN: "" });
  assertTestEnvironment(process.env);
  const db = createClient(TEST_API, status.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const check = (result: { error: unknown }) => { if (result.error) throw result.error; };

  for (const [id, externalId, title, classification] of records) {
    const existing = await db.from("source_records").select("id").eq("id", id).maybeSingle();
    check(existing);
    let jobId: string;
    if (!existing.data) {
      check(await db.from("source_records").insert({ id, source_dataset: "contractacions", source_record_id: externalId, mechanism: "Contractació pública", title, provider_name: "Entitat fictícia de previsualització", source_payload: { fixture: true, fixture_classification: classification } }));
      const operation = await db.rpc("begin_record_operation", { p_record: id, p_operation: "process" });
      check(operation);
      await runMockWorkflow(db, operation.data.taskId);
      jobId = operation.data.jobId;
    } else {
      const job = await db.from("pipeline_jobs").select("id").eq("source_record_id", id).order("created_at", { ascending: false }).limit(1).single();
      check(job);
      if (!job.data) throw new Error(`Missing pipeline job for ${externalId}`);
      jobId = job.data.id;
    }
    if (externalId === "UI-PREVIEW-APPROVED") {
      const provision = await db.from("service_provisions").select("id").eq("source_record_id", id).maybeSingle();
      check(provision);
      if (provision.data) continue;
      const candidate = await db.from("matching_candidates").select("id,pipeline_job_id").eq("pipeline_job_id", jobId).order("rank").limit(1).single();
      check(candidate);
      if (!candidate.data) throw new Error(`Missing matching candidate for ${externalId}`);
      const review = await db.rpc("review_analysis", { p_record: id, p_outcome: "select", p_expected_job: jobId, p_reasons: [], p_candidate: candidate.data.id, p_code: null, p_notes: "Aprovació humana fictícia per comprovar la interfície local." });
      check(review);
    }
  }

  const pausedRecord = "71000000-0000-4000-8000-000000000006";
  const pausedRun = "72000000-0000-4000-8000-000000000006";
  const activeRecord = "71000000-0000-4000-8000-000000000007";
  const activeRun = "72000000-0000-4000-8000-000000000007";
  const exists = await db.from("source_records").select("id").in("id", [pausedRecord, activeRecord]);
  check(exists);
  if ((exists.data ?? []).length === 0) {
    check(await db.from("source_records").insert([
      { id: pausedRecord, source_dataset: "convenis", source_record_id: "UI-PREVIEW-PAUSED", mechanism: "Conveni", title: "Lot fictici pausat i recuperable", source_payload: { fixture: true }, processing_status: "preparant" },
      { id: activeRecord, source_dataset: "raisc_local", source_record_id: "UI-PREVIEW-ACTIVE", mechanism: "Subvenció", title: "Lot fictici en procés", source_payload: { fixture: true }, processing_status: "preparant" },
    ]));
    check(await db.from("pipeline_runs").insert([
      { id: pausedRun, status: "paused", stage: "preparation", pause_kind: "transient", pause_reason: "Pausa fictícia recuperable", parameters: { purpose: "automated_cloud" } },
      { id: activeRun, status: "preparing", stage: "preparation", parameters: { purpose: "automated_cloud" } },
    ]));
    const jobs = await db.from("pipeline_jobs").insert([
      { run_id: pausedRun, source_record_id: pausedRecord, status: "selected", preparation_status: "pending", enrichment_status: "pending" },
      { run_id: activeRun, source_record_id: activeRecord, status: "selected", preparation_status: "discovering", enrichment_status: "pending" },
    ]).select("id,run_id");
    check(jobs);
    check(await db.from("worker_tasks").insert((jobs.data ?? []).map((job) => ({ task_type: "process_run", run_id: job.run_id, pipeline_job_id: job.id, executor: "vercel_workflow", status: job.run_id === pausedRun ? "failed" : "running", execution_state: job.run_id === pausedRun ? "paused" : "running", failure_kind: job.run_id === pausedRun ? "transient" : null, lease_until: job.run_id === activeRun ? new Date(Date.now() + 60 * 60 * 1000).toISOString() : null }))));
  }
  console.log("Local preview fixtures ready: active, paused, review, issue, approved, discarded and outside portfolio.");
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
