import "server-only";

import { randomUUID } from "node:crypto";
import { Sandbox } from "@vercel/sandbox";
import { createServerSupabase } from "@/lib/records-page";
import { executionMode } from "@/lib/pipeline/execution-mode";

export type VercelAvailabilityResult = {
  status: "available" | "already_available";
};

const RESOURCE = "sandbox";
const EXPECTED_BLOCK = "vercel_quota";
const PROBE_TIMEOUT_MS = 60_000;

export async function checkVercelAvailability(): Promise<VercelAvailabilityResult> {
  const db = createServerSupabase();
  const current = await db
    .from("cloud_resources")
    .select("blocked_kind,owner,lease_until")
    .eq("name", RESOURCE)
    .single();
  if (current.error) throw new Error("VERCEL_CHECK_DATABASE");
  if (!current.data.blocked_kind) return { status: "already_available" };
  if (current.data.blocked_kind !== EXPECTED_BLOCK) throw new Error("VERCEL_CHECK_UNEXPECTED_BLOCK");

  const leaseActive = Boolean(
    current.data.lease_until && new Date(current.data.lease_until) > new Date(),
  );
  if (leaseActive) throw new Error("VERCEL_CHECK_BUSY");

  const owner = randomUUID();
  const leaseUntil = new Date(Date.now() + 90_000).toISOString();
  let claim = db
    .from("cloud_resources")
    .update({ owner, lease_until: leaseUntil })
    .eq("name", RESOURCE)
    .eq("blocked_kind", EXPECTED_BLOCK);
  claim = current.data.owner
    ? claim.eq("owner", current.data.owner)
    : claim.is("owner", null);
  const claimed = await claim.select("name").maybeSingle();
  if (claimed.error) throw new Error("VERCEL_CHECK_DATABASE");
  if (!claimed.data) throw new Error("VERCEL_CHECK_BUSY");

  let sandbox: Sandbox | undefined;
  try {
    if (!isMockEnvironment()) {
      if (executionMode() !== "vercel_workflow") throw new Error("VERCEL_CHECK_DISABLED");
      const snapshotId = process.env.CLOUD_SANDBOX_SNAPSHOT;
      if (!snapshotId) throw new Error("VERCEL_CHECK_CONFIGURATION");
      sandbox = await Sandbox.create({
        source: { type: "snapshot", snapshotId },
        timeout: PROBE_TIMEOUT_MS,
        resources: { vcpus: 1 },
        networkPolicy: "deny-all",
      });
      const command = await sandbox.runCommand("sh", ["-c", "true"], { timeoutMs: 5_000 });
      if (command.exitCode !== 0) throw new Error("VERCEL_CHECK_COMMAND");
    }

    const cleared = await db
      .from("cloud_resources")
      .update({ blocked_kind: null, owner: null, lease_until: null })
      .eq("name", RESOURCE)
      .eq("owner", owner)
      .eq("blocked_kind", EXPECTED_BLOCK)
      .select("name")
      .maybeSingle();
    if (cleared.error || !cleared.data) throw new Error("VERCEL_CHECK_DATABASE");
    return { status: "available" };
  } catch (error) {
    await db
      .from("cloud_resources")
      .update({ owner: null, lease_until: new Date(Date.now() + 60_000).toISOString() })
      .eq("name", RESOURCE)
      .eq("owner", owner);
    throw normalizeAvailabilityError(error);
  } finally {
    try {
      await sandbox?.stop();
    } catch {
      // The probe has a one-minute hard expiry even if the explicit stop fails.
    }
  }
}

function isMockEnvironment() {
  return Boolean(process.env.WORKFLOW_TEST_PROJECT) || process.env.PIPELINE_PROVIDER === "mock";
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
