import { portfolioStatusLabel } from "./ui-labels";

export const masterReferenceLabels: Record<string, string> = {
  "Estado": "Situació a la Cartera", "Código Cartera": "Codi de Cartera",
  "Nombre del servicio": "Nom del servei", "Ámbito sectorial / colectivo": "Àmbit sectorial / col·lectiu",
  "Importe total": "Import total", "Concierto importe": "Import de concerts",
  "Subvención importe": "Import de subvencions", "Convenio importe": "Import de convenis",
  "Contratación importe": "Import de contractacions", "Concierto provisiones": "Provisions de concerts",
  "Subvención provisiones": "Provisions de subvencions", "Convenio provisiones": "Provisions de convenis",
  "Contratación provisiones": "Provisions de contractacions", "Confianza general": "Confiança general",
  "% Drets Socials": "% Drets Socials", "% otros departamentos": "% altres departaments",
  "Nº entidades prestadoras": "Nombre d’entitats prestadores", "Plazas / capacidad": "Places / capacitat",
  "Mecanismo dominante": "Mecanisme predominant",
};

export function isReferenceFormula(key: string) {
  return /^f[oó]rmula\s*[·:]/i.test(key.trim());
}

export function referenceFieldLabel(key: string) {
  return masterReferenceLabels[key] ?? key;
}

export function formatReferenceValue(key: string, value: unknown): string {
  if (value == null || (typeof value === "string" && (!value.trim() || /^(null|undefined|sin datos)$/i.test(value.trim())))) return "No informat";
  // A formula is provenance, never an evaluated service value.
  if (!isReferenceFormula(key) && typeof value === "string" && value.trim().startsWith("=")) return "Resultat no disponible al fitxer";
  if (key === "Estado" && typeof value === "string") return portfolioStatusLabel(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "No informat";
    if (/importe/i.test(key)) return new Intl.NumberFormat("ca-ES", { style: "currency", currency: "EUR" }).format(value);
    if (key.startsWith("%")) return new Intl.NumberFormat("ca-ES", { style: "percent", maximumFractionDigits: 2 }).format(value);
    if (key === "Confianza general") return new Intl.NumberFormat("ca-ES", { style: "percent", maximumFractionDigits: 2 }).format(value <= 1 ? value : value / 100);
    return new Intl.NumberFormat("ca-ES", { maximumFractionDigits: 6 }).format(value);
  }
  if (typeof value === "boolean") return value ? "Sí" : "No";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export function referenceEntries(payload: Record<string, unknown>, formulas: boolean) {
  return Object.entries(payload).filter(([key]) => isReferenceFormula(key) === formulas);
}

export function isIllustrativeReference(payload: Record<string, unknown>) {
  // Mark only explicit wording in the source, not inferred example codes.
  return /ejemplo ilustrativo|exemple il·lustratiu/i.test(String(payload["Nombre del servicio"] ?? ""));
}
