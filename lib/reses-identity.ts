// Source placeholders are not legal identities. Keep the raw payload separately.
export function resesText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && !/^(null|undefined)$/i.test(text) ? text : null;
}

export function normalizeResesNif(value: unknown): string {
  const text = resesText(value);
  const nif = text?.toUpperCase().replace(/[\s.-]/g, "") ?? "";
  // Format validation, not certification of ownership or the check digit.
  return /^(?:[0-9]{8}[A-Z]|[A-Z][0-9]{7}[A-Z0-9])$/.test(nif) ? nif : "";
}

export function resesHolder(row: Record<string, unknown>): { nif: string; name: string } | null {
  const nif = normalizeResesNif(row.nif);
  const name = resesText(row.entitat_titular);
  return nif && name ? { nif, name } : null;
}

export function isResesService(row: Record<string, unknown>): boolean {
  return /^S[0-9]{5}$/.test(resesText(row.registre) ?? "") && !!resesText(row.nom);
}
