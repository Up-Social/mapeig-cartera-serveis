export type SourceDocumentLink = {
  url: string;
  document_type: string;
  source_fields?: string[] | null;
};

const REGULATORY_FIELD = /\bbases?\s+regulador(?:a|as|es)?\b/;

export function classifySourceDocumentField(field: string) {
  const name = normalizeField(field);
  if (REGULATORY_FIELD.test(name)) return "regulatory_basis";
  if (name.includes("annex") || name.includes("descarrega annex")) return "annex";
  if (name.includes("document conveni")) return "agreement";
  if (name.includes("diari oficial") || name.includes("ultima publicacion")) return "publication";
  if (name.includes("organo de contratacion")) return "contracting_profile";
  return "other";
}

export function resolveRegulatoryBasisUrl(
  payload: Record<string, unknown>,
  documents: SourceDocumentLink[],
) {
  const payloadUrl = Object.entries(payload).find(
    ([field, value]) =>
      REGULATORY_FIELD.test(normalizeField(field)) && extractUrl(value),
  );
  if (payloadUrl) return extractUrl(payloadUrl[1]);

  const explicitDocument = documents.find(
    (document) =>
      document.document_type === "regulatory_basis" ||
      document.source_fields?.some((field) =>
        REGULATORY_FIELD.test(normalizeField(field)),
      ),
  );
  return explicitDocument?.url ?? null;
}

function normalizeField(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("ca")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extractUrl(value: unknown) {
  if (typeof value !== "string") return null;
  const candidate = value.match(/https?:\/\/[^\s|]+/i)?.[0];
  if (!candidate) return null;
  return candidate.replace(/[),.;]+$/g, "");
}
