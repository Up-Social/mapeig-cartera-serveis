/** Independent economic routes must use the full coverage and reconciliation
 * workflow together. Legacy deployments with neither independent flag retain
 * their existing behavior. */
export function independentEconomicConfigurationError(): string | null {
 const review = process.env.CONVENI_INDEPENDENT_REVIEW_ENABLED === 'true';
 const readers = process.env.CONVENI_INDEPENDENT_READERS_READY === 'true';
 if (!review && !readers) return null;
 if (!review || !readers || process.env.CONVENI_ECONOMIC_REVIEW_ENABLED !== 'true'
  || process.env.CONVENI_ECONOMIC_COVERAGE_ENABLED !== 'true'
  || process.env.CONVENI_ECONOMIC_RECONCILIATION_ENABLED !== 'true') {
  return 'La revisió econòmica independent necessita activar conjuntament la revisió, els lectors, la cobertura completa i la conciliació. Contacta amb l’administració abans de continuar.';
 }
 return null;
}
