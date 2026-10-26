import "server-only";

import { createServerSupabase } from "@/lib/records-page";
import { probeVercelAvailability, type VercelAvailabilityOptions } from "./sandbox-probe";
export type { VercelAvailabilityResult } from "./sandbox-probe";

export function checkVercelAvailability(options: VercelAvailabilityOptions = {}) {
  return probeVercelAvailability(createServerSupabase(), options);
}
