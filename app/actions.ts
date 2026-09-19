"use server";
import {executionMode} from "@/lib/pipeline/execution-mode";
import {createCloudRun} from "@/lib/cloud/enqueue";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/records-page";
import {startRecordOperation} from "@/lib/start-record-operation";
import { requireUuid } from "@/lib/uuid";

export async function createProcessingBatch(recordIds: string[]) {
  if(executionMode()==='disabled')throw new Error('Execució desactivada en aquest entorn.');
  const ids = [...new Set(recordIds)];
  if (ids.length < 1 || ids.length > 50)
    throw new Error("Selecciona entre 1 i 50 registres.");
  if(executionMode()==='vercel_workflow')return {runId:await createCloudRun(ids.map(requireUuid)),count:ids.length};
  const supabase = createServerSupabase();
  const { data: existing, error: readError } = await supabase
    .from("source_records")
    .select("id")
    .in("id", ids);
  if (readError) throw readError;
  if ((existing?.length ?? 0) !== ids.length)
    throw new Error("La selecció conté registres inexistents.");
  const { data: run, error: runError } = await supabase
    .from("pipeline_runs")
    .insert({
      status: "queued",
      selected_count: ids.length,
      parameters: { matching: "pending_configuration" },
    })
    .select("id")
    .single();
  if (runError) throw runError;
  const { error: jobsError } = await supabase.from("pipeline_jobs").insert(
    ids.map((id) => ({
      run_id: run.id,
      source_record_id: id,
      status: "queued",
    })),
  );
  if (jobsError) throw jobsError;
  const { error: recordsError } = await supabase
    .from("source_records")
    .update({
      processing_status: "preparant",
      updated_at: new Date().toISOString(),
    })
    .in("id", ids);
  if (recordsError) throw recordsError;
  revalidatePath("/");
  return { runId: String(run.id), count: ids.length };
}

export async function processRecordAutomatically(id:string){return startRecordOperation(id,'process');}
export async function recoverRecordWithOcr(id:string){return startRecordOperation(id,'ocr');}
export async function prepareRecordSources(id:string){return startRecordOperation(id,'prepare');}
export async function enrichRecordFromSources(id:string){return startRecordOperation(id,'enrich');}
export async function matchPreparedRecord(id:string){return startRecordOperation(id,'match');}

export async function reviewMatching(input: {
  expectedJobId: string;
  reasons: string[];
  sourceRecordId: string;
  candidateId?: string;
  serviceCode?: string;
  outcome: "select" | "reject" | "insufficient" | "outside";
  notes?: string;
}) {
  const {error}=await createServerSupabase().rpc('review_analysis',{p_record:input.sourceRecordId,p_outcome:input.outcome,p_expected_job:input.expectedJobId,p_reasons:input.reasons,p_candidate:input.candidateId??null,p_code:input.serviceCode??null,p_notes:input.notes?.trim().slice(0,1000)??null});
  if(error)throw error;

  revalidatePath("/");
  revalidatePath("/review");
  revalidatePath("/issues");
  revalidatePath("/approved");
  revalidatePath("/catalog");
  revalidatePath("/discarded");
  revalidatePath("/analysis");
  revalidatePath("/batches");
  return { ok: true };
}
