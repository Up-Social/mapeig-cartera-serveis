import "server-only";
import { createServerSupabase } from "./records-page";

export function pendingResesQuery(q: string, county: string) {
  let request = createServerSupabase().from("reses_services").select("*", {count:"exact"}).is("entity_id",null);
  const safe = q.replace(/[,%()]/g," ").trim();
  if (safe) request = request.or(`registry_number.ilike.%${safe}%,service_name.ilike.%${safe}%,municipality.ilike.%${safe}%`);
  if (county && county!=="totes") request = request.eq("county",county);
  return request.order("registry_number");
}
