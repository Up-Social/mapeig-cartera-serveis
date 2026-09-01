import type { SourceRecord } from "./workbench-types";

type ReviewInput = {
  candidateId?: string;
  serviceCode?: string;
  outcome: "select" | "reject" | "insufficient";
  notes?: string;
};

export async function submitRecordReview(
  sourceRecordId: string,
  input: ReviewInput,
) {
  const response = await fetch(
    `/api/records/${encodeURIComponent(sourceRecordId)}/review`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  const payload = (await response.json()) as {
    record?: SourceRecord;
    error?: string;
  };
  if (!response.ok || !payload.record) {
    throw new Error(payload.error || "No s'ha pogut registrar la decisió.");
  }
  return payload.record;
}
