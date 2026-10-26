import "server-only";

import { createServerSupabase } from "@/lib/records-page";
import { probeVercelAvailability } from "./sandbox-probe";
export type { VercelAvailabilityResult } from "./sandbox-probe";

export function checkVercelAvailability(options: { force?: boolean } = {}) {
  return probeVercelAvailability(createServerSupabase(), options);
}
