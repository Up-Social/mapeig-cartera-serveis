import {createHash} from "node:crypto";
import {classifySourceDocumentField} from "../provision-links";
type SourceRow = { id: string; source_payload: Record<string, unknown> };
type DocumentRow = {
  source_record_id: string; url: string; url_hash: string; document_type: string;
  source_fields: string[]; status: "discovered"; updated_at: string;
};

export function discoverRecordDocuments(record: SourceRow): DocumentRow[] {
  const byUrl = new Map<string, { fields: string[]; type: string }>();
  for (const [field, value] of Object.entries(record.source_payload ?? {})) {
    if (typeof value !== "string") continue;
    for (const candidate of value.match(/https?:\/\/[^\s|]+/gi) ?? []) {
      const normalized = normalizeUrl(candidate);
      if (!normalized) continue;
      const existing = byUrl.get(normalized);
      if (existing) {
        if (!existing.fields.includes(field)) existing.fields.push(field);
      } else {
        byUrl.set(normalized, {
          fields: [field],
          type: classifySourceDocumentField(field),
        });
      }
    }
  }
  const now = new Date().toISOString();
  return [...byUrl.entries()].map(([documentUrl, metadata]) => ({
    source_record_id: record.id,
    url: documentUrl,
    url_hash: createHash("sha256").update(documentUrl).digest("hex"),
    document_type: metadata.type,
    source_fields: metadata.fields.sort(),
    status: "discovered",
    updated_at: now,
  }));
}

function normalizeUrl(candidate: string) {
  const cleaned = candidate.replace(/[),.;]+$/g, "");
  try {
    const parsed = new URL(cleaned);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    parsed.hash = "";
    return parsed.toString();
  } catch { return null; }
}

