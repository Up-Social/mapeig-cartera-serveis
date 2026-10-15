/** Verification attempts are available in their batch, but never replace a human result. */
export function effectiveJobs(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((job): job is Record<string, unknown> => !!job && typeof job === 'object' && job.verification_only !== true)
    : [];
}
