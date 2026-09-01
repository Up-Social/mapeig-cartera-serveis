/**
 * Source records may carry an internal deduplication suffix (`official-id::hash`).
 * Keep it in the database for uniqueness, but never expose it as the official ID.
 */
export function displaySourceIdentifier(value: string): string {
  return value.split("::", 1)[0] || value;
}
