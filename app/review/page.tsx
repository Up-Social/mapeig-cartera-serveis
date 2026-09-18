import {executionMode} from '@/lib/pipeline/execution-mode';
import { getReviewQueue, getSourceRecord } from "@/lib/records-page";
import { createServerSupabase } from "@/lib/records-page";
import { ReviewWorkbench } from "./review-workbench";
import { prioritizeById } from "@/lib/latest-job-state";
import { isUuid } from "@/lib/uuid";
import {getJobRecord} from '@/lib/job-record';

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
export default async function ReviewPage({ searchParams }: Props) {
  const params = await searchParams;
  const focusedRecordId = typeof params.record === "string" && isUuid(params.record) ? params.record : undefined;
  const filters = {
    batchId: typeof params.batch === "string" ? params.batch : undefined,
    type: typeof params.type === "string" ? params.type : "totes",
    state: params.state === 'all' ? 'all' : 'pending',
    query: typeof params.q === "string" ? params.q.slice(0, 120) : "",
  };
  const [queue, services] = await Promise.all([
    getReviewQueue(filters),
    createServerSupabase()
      .from("eligible_official_services")
      .select("service_code,service_name,target_population")
      .order("service_code"),
  ]);
  if (services.error) throw services.error;
  const historyEnabled=executionMode()==='vercel_workflow';
  const history=historyEnabled?await createServerSupabase().from('pipeline_runs').select('id').eq('parameters->>history_campaign','normative-history-v1').maybeSingle():null;
  if(history?.error)throw history.error;
  const focused=typeof params.job==='string'&&isUuid(params.job)?await getJobRecord(params.job):focusedRecordId?await getSourceRecord(focusedRecordId):null;
  if(focused&&!queue.records.some(r=>r.id===focused.id))queue.records.unshift(focused);
  const focusedQueue = {
    ...queue,
    records: prioritizeById(queue.records, focusedRecordId),
  };
  return (
    <ReviewWorkbench
      key={`${focusedRecordId ?? "queue"}:${focusedQueue.records.map((record) => `${record.id}:${record.analysis?.id ?? "legacy"}:${record.analysis?.reviewed_classification ?? "auto"}:${record.status}:${record.reviewDecision ?? "pending"}`).join("|")}`}
      historyEnabled={historyEnabled}
      historyRunId={history?.data?.id??null}
      queue={focusedQueue}
      filters={filters}
      focusedRecordId={focusedRecordId}
      services={(services.data ?? []).map((service) => ({
        code: service.service_code,
        name: service.service_name,
        scope: service.target_population,
      }))}
    />
  );
}
