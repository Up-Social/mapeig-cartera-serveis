export function mapLatestMatchingError(value: unknown) {
  if (!Array.isArray(value) || !value.length) return null;
  const latest = [...value]
    .map((item) => item as Record<string, unknown>)
    .sort((a, b) =>
      String(b.created_at).localeCompare(String(a.created_at)),
    )[0];
  return latest.status === "error" && latest.error_message != null
    ? String(latest.error_message)
    : null;
}
