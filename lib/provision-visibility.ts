/** The current schema must return computed visibility from the database.
 * Missing, null or malformed values are errors rather than a legacy fallback. */
function currentFlag(row: unknown, field: 'provision_is_current' | 'entity_relation_is_current'): boolean {
  if (!row || typeof row !== 'object' || typeof (row as Record<string, unknown>)[field] !== 'boolean') {
    throw new Error(`No es pot verificar la vigència: falta el camp ${field}.`);
  }
  return (row as Record<string, boolean>)[field];
}

/** Legacy mode is explicitly selected by the runtime, not inferred from data. */
export function visibleProvision(row: unknown, legacy: boolean): boolean {
  if (legacy) return Boolean(row && typeof row === 'object' && !(row as Record<string, unknown>).superseded_at);
  return currentFlag(row, 'provision_is_current');
}

export function visibleEntityRelation(row: unknown, legacy: boolean): boolean {
  if (legacy) return Boolean(row && typeof row === 'object' && !(row as Record<string, unknown>).retired_at);
  return currentFlag(row, 'entity_relation_is_current');
}

/** Batch exports include current provisions of its source records, even if
 * another job reviewed them later. The review job is not a filter here. */
export function visibleProvisions<T>(rows: readonly T[], legacy: boolean): T[] {
  return rows.filter(row => visibleProvision(row, legacy));
}
