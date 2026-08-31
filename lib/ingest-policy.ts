import type { IngestDecision, IngestRequest, ReplayWindowEntry } from "./types";
import { verifyHmacSha256 } from "./hmac";

export const DEFAULT_REPLAY_WINDOW_MS = 5 * 60 * 1000;

/**
 * Exponential backoff delays (ms) for simulated failed-delivery retries.
 * attempt 1 → 1s, 2 → 2s, 3 → 4s, 4 → 8s, 5 → 16s
 */
export function backoffDelayMs(attempt: number): number {
  if (attempt < 1) {
    return 0;
  }
  return Math.min(60_000, 1000 * 2 ** (attempt - 1));
}

/**
 * Pure policy: decide whether an ingest should be accepted.
 * Caller supplies the endpoint secret and recent delivery IDs for replay checks.
 */
export function evaluateIngest(options: {
  request: IngestRequest;
  endpointSecret: string;
  endpointWorkspaceId: string;
  recentDeliveries: ReplayWindowEntry[];
  now?: number;
  replayWindowMs?: number;
}): IngestDecision {
  const {
    request,
    endpointSecret,
    endpointWorkspaceId,
    recentDeliveries,
    now = Date.now(),
    replayWindowMs = DEFAULT_REPLAY_WINDOW_MS,
  } = options;

  // Tenant isolation: org / workspace claim must match the endpoint owner.
  if (
    request.claimedWorkspaceId !== undefined &&
    request.claimedWorkspaceId !== endpointWorkspaceId
  ) {
    return {
      ok: false,
      status: "rejected_tenant",
      reason: "Workspace claim does not match endpoint tenant",
    };
  }

  if (request.workspaceId !== endpointWorkspaceId) {
    return {
      ok: false,
      status: "rejected_tenant",
      reason: "Request workspace does not match endpoint tenant",
    };
  }

  const sig = verifyHmacSha256(
    endpointSecret,
    request.rawBody,
    request.signatureHeader
  );
  if (!sig.valid) {
    return {
      ok: false,
      status: "rejected_signature",
      reason:
        sig.provided === null
          ? "Missing X-Harbor-Signature header"
          : "HMAC-SHA256 signature mismatch",
    };
  }

  if (!request.deliveryId || !request.deliveryId.trim()) {
    return {
      ok: false,
      status: "rejected_replay",
      reason: "Missing X-Harbor-Delivery-Id header",
    };
  }

  const windowStart = now - replayWindowMs;
  const duplicate = recentDeliveries.find(
    (entry) =>
      entry.endpointId === request.endpointId &&
      entry.deliveryId === request.deliveryId &&
      entry.seenAt >= windowStart
  );

  if (duplicate) {
    return {
      ok: false,
      status: "rejected_replay",
      reason: `Duplicate delivery id within ${replayWindowMs}ms window`,
    };
  }

  return { ok: true, status: "accepted" };
}

/**
 * Record a seen delivery id into the replay window list (immutable helper).
 */
export function appendReplayEntry(
  recent: ReplayWindowEntry[],
  entry: ReplayWindowEntry,
  now = Date.now(),
  replayWindowMs = DEFAULT_REPLAY_WINDOW_MS
): ReplayWindowEntry[] {
  const windowStart = now - replayWindowMs;
  return [...recent.filter((e) => e.seenAt >= windowStart), entry];
}
