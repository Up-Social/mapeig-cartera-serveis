export const ANALYSIS_EVIDENCE_LIMIT = 12;

type EvidenceChunk = {
  source_document_id: string;
  ordinal: number;
};

export function selectEvidenceWindow<T extends EvidenceChunk>(
  chunks: T[],
  limit = ANALYSIS_EVIDENCE_LIMIT,
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
