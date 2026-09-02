export type MatchingRationalePart = {
  label: "Encaix" | "Diferenciació" | "Limitació";
  text: string;
};

export function parseMatchingRationale(value: string): MatchingRationalePart[] {
  const normalized = value.trim();
  if (!normalized) return [];

  const matches = [...normalized.matchAll(/(Encaix|Diferenciació|Limitació)\s*:/gi)];
  const parts = matches.map((match, index) => {
    const canonicalLabel = match[1].toLocaleLowerCase("ca") === "encaix"
      ? "Encaix"
      : match[1].toLocaleLowerCase("ca") === "diferenciació"
        ? "Diferenciació"
        : "Limitació";
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? normalized.length;
    return {
      label: canonicalLabel as MatchingRationalePart["label"],
      text: normalized.slice(start, end).trim().replace(/\s+/g, " "),
    };
  }).filter((part) => part.text.length > 0);

  return parts.length >= 2 ? parts : [];
}
