const JAVASCRIPT_SHELL_PATTERNS = [
  /navegador no suporta javascript/i,
  /browser does not support javascript/i,
  /enable javascript/i,
];

export function isUnusableWebExtraction(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return (
    JAVASCRIPT_SHELL_PATTERNS.some((pattern) => pattern.test(normalized)) &&
    normalized.length < 1_000
  );
}

export function buildSourcePayloadEvidence(payload: Record<string, unknown>) {
  const lines = Object.entries(payload).flatMap(([field, value]) => {
    if (value == null || field.startsWith("Fórmula ·")) return [];
    if (!["string", "number", "boolean"].includes(typeof value)) return [];
    const text = String(value).trim();
    if (!text || text.startsWith("=")) return [];
    return [`${field}: ${text}`];
  });
  if (!lines.length) return "";
  return ["Dades oficials del registre d'origen", ...lines].join("\n");
}
