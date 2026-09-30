/** Persisted phase names are a contract with cloud_provider_usage. */
export const POSITIVE_AUDIT_VERSION = 'positive-audit-v4';
export const CONTRACT_REPAIR_VERSION = 'contract-repair-v1';
export const USAGE_PHASES = ['enrichment', 'analysis', 'positive-audit-v1', 'positive-audit-v2', 'positive-audit-v3', POSITIVE_AUDIT_VERSION, CONTRACT_REPAIR_VERSION] as const;
