const RETURN_PATHS = new Set(["/", "/review", "/issues", "/approved", "/discarded", "/analysis"]);

export function safeCaseOrigin(value: unknown): string {
  if (typeof value !== "string" || value.length > 1000 || !value.startsWith("/") || value.startsWith("//")) return "/review";
  const url = new URL(value, "http://local.invalid");
  if (url.origin !== "http://local.invalid" || (!RETURN_PATHS.has(url.pathname) && !/^\/batches\/[0-9a-f-]+\/results$/.test(url.pathname))) return "/review";
  return `${url.pathname}${url.search}`;
}
