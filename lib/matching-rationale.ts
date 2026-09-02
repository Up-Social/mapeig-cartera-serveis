export type MatchingRationalePart = {
  label: "Encaix" | "Diferenciació" | "Limitació";
  text: string;
};

export function parseMatchingRationale(value: string): MatchingRationalePart[] {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return [];

  const pattern = /(Encaix|Diferenciació|Limitació):\s*([\s\S]*?)(?=\s+(?:Encaix|Diferenciació|Limitació):|$)/g;
  const parts = [...normalized.matchAll(pattern)]
    .map((match) => ({
      label: match[1] as MatchingRationalePart["label"],
      text: match[2].trim(),
    }))
    .filter((part) => part.text.length > 0);

  return parts.length >= 2 ? parts : [];
}
