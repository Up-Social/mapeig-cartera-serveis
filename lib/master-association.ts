/** The official-catalog migration introduced this key before unit_id, so an
 * old schema without units may still require the historical master key. */
export function legacyMasterKey(error: {code?: string} | null): 'historical_master_code' | 'service_code' {
  if (!error) return 'historical_master_code';
  if (error.code === '42703' || error.code === 'PGRST204') return 'service_code';
  throw error;
}

/** A filtered DB query must only return rows belonging to the requested page. */
export function groupByMasterCode<T extends Record<string,unknown>>(codes: readonly string[], rows: readonly T[], field: string): Map<string,T[]> {
  const allowed=new Set(codes);
  const result=new Map<string,T[]>();
  for (const row of rows) {
    const value=row[field];
    if (typeof value !== 'string' || !allowed.has(value)) throw new Error('Relació de catàleg sense codi de servei vàlid');
    const group=result.get(value);
    if (group) group.push(row); else result.set(value,[row]);
  }
  return result;
}
