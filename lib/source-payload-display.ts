const FIELD_LABELS: Record<string, string> = {
  tags: "Etiquetes",
  titol: "Títol",
  connector: "Origen",
  id_edicte: "Identificador de l’edicte",
  period_to: "Fi del període",
  descripcio: "Descripció",
  event_type: "Tipus d’esdeveniment",
  record_url: "Enllaç del registre",
  period_from: "Inici del període",
  retrieved_at: "Data de consulta",
  data_retirada: "Data de retirada",
  matched_terms: "Termes coincidents",
  financing_type: "Tipologia",
  source_dataset: "Font de dades",
  classificacions: "Classificacions",
  data_publicacio: "Data de publicació",
  source_record_id: "Identificador d’origen",
  source_payload_hash: "Empremta d’integritat",
  counts_as_new_financing: "Compta com a nou finançament",
  tipus: "Tipus",
  concepte: "Concepte",
  categoria: "Categoria",
  subcategoria: "Subcategoria",
};

const VALUE_LABELS: Record<string, string> = {
  HISTORIC: "Històric",
  etauler: "e-Tauler",
  nova_provisio_o_ampliacio: "Nova provisió o ampliació",
  contractacio: "Contractació pública",
  conveni: "Conveni",
  subvencio: "Subvenció",
  concert: "Concert social / gestió delegada",
  concerts: "Concert social / gestió delegada",
};

const DATE_FIELDS = new Set([
  "period_to",
  "period_from",
  "retrieved_at",
  "data_retirada",
  "data_publicacio",
]);

export function sourcePayloadFieldLabel(key: string) {
  return FIELD_LABELS[key] ?? humanizeKey(key);
}

export function sourcePayloadValue(key: string, value: unknown): string {
  if (value === true) return "Sí";
  if (value === false) return "No";
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) {
    return value
      .map((item) => formatNestedValue(item))
      .filter(Boolean)
      .join(" · ");
  }
  if (typeof value === "object") return formatNestedValue(value);
  const text = String(value);
  if (DATE_FIELDS.has(key)) return formatDate(text);
  return VALUE_LABELS[text] ?? text;
}

function formatNestedValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (value === true) return "Sí";
  if (value === false) return "No";
  if (Array.isArray(value)) return value.map(formatNestedValue).filter(Boolean).join(", ");
  if (typeof value !== "object") {
    const text = String(value);
    return VALUE_LABELS[text] ?? text;
  }
  return Object.entries(value)
    .filter(([, nested]) => nested !== null && nested !== "")
    .map(([nestedKey, nested]) => `${sourcePayloadFieldLabel(nestedKey)}: ${formatNestedValue(nested)}`)
    .join(" · ");
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const includesTime = value.includes("T");
  return new Intl.DateTimeFormat("ca-ES", includesTime
    ? { dateStyle: "short", timeStyle: "medium" }
    : { dateStyle: "short" }).format(date);
}

function humanizeKey(key: string) {
  const normalized = key.replaceAll("_", " ").trim();
  return normalized ? normalized[0].toLocaleUpperCase("ca-ES") + normalized.slice(1) : key;
}
