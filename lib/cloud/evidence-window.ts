export const ANALYSIS_EVIDENCE_LIMIT = 12;

type EvidenceChunk = {
  source_document_id: string;
  ordinal: number;
  content?: string;
};

export function selectEvidenceWindow<T extends EvidenceChunk>(
  chunks: T[],
  limit = ANALYSIS_EVIDENCE_LIMIT,
  legacy = false,
) {
  if (limit <= 0) return [];
  if (chunks.length <= limit) return [...chunks];

  const documents = new Map<string, T[]>();
  for (const chunk of chunks) {
    const documentChunks = documents.get(chunk.source_document_id) ?? [];
    documentChunks.push(chunk);
    documents.set(chunk.source_document_id, documentChunks);
  }

  const selected = new Set<T>();
  if (!legacy) {
    // Reserve at most a third of the window for explicit codes and annex rows.
    // The remaining slots preserve document coverage and beginning/end context.
    const score = (chunk:T) => (chunk.content?.match(/\b1(?:\.\d+){2,6}\b/g)?.length ?? 0)*5 + (chunk.content?.match(/annex|adjudicat|concert|pròrroga|places|destinatar/gi)?.length ?? 0);
    const ranked=[...chunks].sort((a,b)=>score(b)-score(a));
    for (const chunk of ranked.slice(0,Math.floor(limit/3))) if(score(chunk)>0)selected.add(chunk);
  }
  let depth = 0;
  let added = true;

  while (selected.size < limit && added) {
    added = false;
    for (const documentChunks of documents.values()) {
      const head = documentChunks[depth];
      const tail = documentChunks[documentChunks.length - 1 - depth];

      for (const candidate of [head, tail]) {
        if (!candidate || selected.has(candidate)) continue;
        selected.add(candidate);
        added = true;
        if (selected.size === limit) break;
      }
      if (selected.size === limit) break;
    }
    depth += 1;
  }

  return chunks.filter((chunk) => selected.has(chunk));
}
