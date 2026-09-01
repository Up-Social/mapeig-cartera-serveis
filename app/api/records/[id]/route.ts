import { getSourceRecord } from "@/lib/records-page";
import { createRecordStatusResponse } from "@/lib/record-status-response";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return createRecordStatusResponse(id, getSourceRecord);
}
