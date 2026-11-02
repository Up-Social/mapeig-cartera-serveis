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
    // Some stored rationales contain literal escaped line breaks between
    // sections. Remove them at the section boundary only; literal escapes
    // within the explanation can be meaningful and must be preserved.
    const rawSection = normalized.slice(start, end).trim();
    const section = index + 1 < matches.length
      ? rawSection.replace(/(?:(?<!\\)(?:\\r\\n|\\n|\\r)|\s)+$/, "")
      : rawSection;
    return {
      label: canonicalLabel as MatchingRationalePart["label"],
      text: section.replace(/\s+/g, " "),
    };
  }).filter((part) => part.text.length > 0);

  return parts.length >= 2 ? parts : [];
}
