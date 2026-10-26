import { randomUUID } from "node:crypto";
import { createEphemeralSandbox, SandboxLifecycleError, type EphemeralSandbox } from "./sandbox";
import { containSandboxIncident } from "./sandbox-incident";
import { assertTestEnvironment } from "../test-environment";
import type { SupabaseClient } from "@supabase/supabase-js";
import { executionMode } from "../pipeline/execution-mode";

export type VercelAvailabilityResult = {
  status: "available" | "already_available";
};

const RESOURCE = "sandbox";
const EXPECTED_BLOCK = "vercel_quota";

export async function probeVercelAvailability(db: SupabaseClient, options: { force?: boolean } = {}): Promise<VercelAvailabilityResult> {
  const current = await db
    .from("cloud_resources")
    .select("blocked_kind,owner,lease_until")
    .eq("name", RESOURCE)
    .single();
  if (current.error) throw new Error("VERCEL_CHECK_DATABASE");
  if (!current.data.blocked_kind && !options.force) return { status: "already_available" };
  if (current.data.blocked_kind && current.data.blocked_kind !== EXPECTED_BLOCK && !(options.force && current.data.blocked_kind === "internal")) throw new Error("VERCEL_CHECK_UNEXPECTED_BLOCK");

  const leaseActive = Boolean(
    current.data.lease_until && new Date(current.data.lease_until) > new Date(),
  );
  if (leaseActive) throw new Error("VERCEL_CHECK_BUSY");

  const owner = randomUUID();
  const leaseUntil = new Date(Date.now() + 12 * 60_000).toISOString();
  let claim = db
    .from("cloud_resources")
    .update({ owner, lease_until: leaseUntil })
    .eq("name", RESOURCE);
  claim = current.data.blocked_kind ? claim.eq("blocked_kind", current.data.blocked_kind) : claim.is("blocked_kind", null);
  claim = current.data.owner
    ? claim.eq("owner", current.data.owner)
    : claim.is("owner", null);
  claim = current.data.lease_until
    ? claim.eq("lease_until", current.data.lease_until)
    : claim.is("lease_until", null);
  const claimed = await claim.select("name").maybeSingle();
  if (claimed.error) throw new Error("VERCEL_CHECK_DATABASE");
  if (!claimed.data) throw new Error("VERCEL_CHECK_BUSY");

  let sandbox: EphemeralSandbox | undefined;
  let stopped = false;
  let creationUncertain = false;
  try {
    if (!isMockEnvironment()) {
      if (executionMode() !== "vercel_workflow") throw new Error("VERCEL_CHECK_DISABLED");
      const snapshotId = process.env.CLOUD_SANDBOX_SNAPSHOT;
      if (!snapshotId) throw new Error("VERCEL_CHECK_CONFIGURATION");
      creationUncertain = true;
      sandbox = await createEphemeralSandbox('probe', snapshotId);
      creationUncertain = false;
      const command = await sandbox.session.runCommand("sh", ["-c", "true"], { timeoutMs: 5_000 });
      if (command.exitCode !== 0) throw new Error("VERCEL_CHECK_COMMAND");
      await sandbox.close();
      stopped = true;
    }

    // Availability is established only after successful cleanup without a snapshot.
    let clear = db.from("cloud_resources")
      .update({ blocked_kind: null, owner: null, lease_until: null })
      .eq("name", RESOURCE).eq("owner", owner);
    clear = current.data.blocked_kind ? clear.eq("blocked_kind", current.data.blocked_kind) : clear.is("blocked_kind", null);
    const cleared = await clear.select("name").maybeSingle();
    if (cleared.error || !cleared.data) throw new Error("VERCEL_CHECK_DATABASE");
    return { status: "available" };
  } catch (caught) {
    let error = caught;
    if (sandbox && !stopped) {
      try { await sandbox.close(); stopped = true; }
      catch (cleanupError) { error = cleanupError; }
    }
    const status = (error as { response?: { status?: number } }).response?.status;
    if ([401, 402, 403, 429].includes(status ?? 0)) creationUncertain = false;
    if (error instanceof SandboxLifecycleError || creationUncertain) {
      const code = error instanceof SandboxLifecycleError ? error.code : 'SANDBOX_STOP_UNCONFIRMED';
      try { await containSandboxIncident(db, owner, code); }
      catch { throw new Error("VERCEL_CHECK_DATABASE"); }
      console.error('SANDBOX_LIFECYCLE_INCIDENT', { code, sessionId: sandbox?.sessionId ?? 'unknown' });
    } else {
      const released = await db.from("cloud_resources")
        .update({ owner: null, lease_until: new Date(Date.now() + 60_000).toISOString() })
        .eq("name", RESOURCE).eq("owner", owner);
      if (released.error) throw new Error("VERCEL_CHECK_DATABASE");
    }
    throw normalizeAvailabilityError(error);
  }
}

function isMockEnvironment() {
  const mock = Boolean(process.env.WORKFLOW_TEST_PROJECT) || process.env.PIPELINE_PROVIDER === "mock";
  if (mock) assertTestEnvironment(process.env);
  return mock;
}

function normalizeAvailabilityError(error: unknown) {
  if (error instanceof Error && error.message.startsWith("VERCEL_CHECK_")) return error;
  const value = error as {
    response?: { status?: number };
    json?: { error?: { code?: string } };
  };
  const status = value.response?.status;
  const code = value.json?.error?.code ?? "";
  if (status === 402 || /quota|usage_limit|limit_exceeded/iu.test(code)) {
    return new Error("VERCEL_CHECK_QUOTA");
  }
  if (status === 401 || status === 403) return new Error("VERCEL_CHECK_CONFIGURATION");
  return new Error("VERCEL_CHECK_UNAVAILABLE");
}
