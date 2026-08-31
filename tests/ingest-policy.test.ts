import { describe, expect, it } from "vitest";
import { signBody } from "../lib/hmac";
import {
  appendReplayEntry,
  backoffDelayMs,
  evaluateIngest,
} from "../lib/ingest-policy";
import type { IngestRequest, ReplayWindowEntry } from "../lib/types";

const SECRET = "pier-secret-42";
const WORKSPACE = "ws_alpha";
const ENDPOINT = "ep_berth1";

function baseRequest(overrides: Partial<IngestRequest> = {}): IngestRequest {
  const rawBody = JSON.stringify({ event: "cargo.unloaded" });
  return {
    endpointId: ENDPOINT,
    workspaceId: WORKSPACE,
    deliveryId: "deliv-001",
    rawBody,
    signatureHeader: signBody(SECRET, rawBody),
    headers: {},
    method: "POST",
    path: `/api/ingest/${ENDPOINT}`,
    claimedWorkspaceId: undefined,
    ...overrides,
  };
}

describe("evaluateIngest — valid signature", () => {
  it("accepts a correctly signed delivery", () => {
    const decision = evaluateIngest({
      request: baseRequest(),
      endpointSecret: SECRET,
      endpointWorkspaceId: WORKSPACE,
      recentDeliveries: [],
    });
    expect(decision).toEqual({ ok: true, status: "accepted" });
  });
});

describe("evaluateIngest — invalid signature", () => {
  it("rejects a wrong signature", () => {
    const decision = evaluateIngest({
      request: baseRequest({
        signatureHeader: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      }),
      endpointSecret: SECRET,
      endpointWorkspaceId: WORKSPACE,
      recentDeliveries: [],
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.status).toBe("rejected_signature");
    }
  });

  it("rejects a missing signature header", () => {
    const decision = evaluateIngest({
      request: baseRequest({ signatureHeader: undefined }),
      endpointSecret: SECRET,
      endpointWorkspaceId: WORKSPACE,
      recentDeliveries: [],
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.status).toBe("rejected_signature");
      expect(decision.reason).toMatch(/missing/i);
    }
  });
});

describe("evaluateIngest — replay protection", () => {
  it("rejects a duplicate delivery id inside the window", () => {
    const now = 1_700_000_000_000;
    const recent: ReplayWindowEntry[] = [
      {
        deliveryId: "deliv-001",
        endpointId: ENDPOINT,
        seenAt: now - 30_000,
      },
    ];
    const decision = evaluateIngest({
      request: baseRequest(),
      endpointSecret: SECRET,
      endpointWorkspaceId: WORKSPACE,
      recentDeliveries: recent,
      now,
      replayWindowMs: 300_000,
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.status).toBe("rejected_replay");
      expect(decision.reason).toMatch(/duplicate/i);
    }
  });

  it("allows the same delivery id after the window expires", () => {
    const now = 1_700_000_000_000;
    const recent: ReplayWindowEntry[] = [
      {
        deliveryId: "deliv-001",
        endpointId: ENDPOINT,
        seenAt: now - 400_000,
      },
    ];
    const decision = evaluateIngest({
      request: baseRequest(),
      endpointSecret: SECRET,
      endpointWorkspaceId: WORKSPACE,
      recentDeliveries: recent,
      now,
      replayWindowMs: 300_000,
    });
    expect(decision).toEqual({ ok: true, status: "accepted" });
  });

  it("rejects a missing delivery id", () => {
    const decision = evaluateIngest({
      request: baseRequest({ deliveryId: "" }),
      endpointSecret: SECRET,
      endpointWorkspaceId: WORKSPACE,
      recentDeliveries: [],
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.status).toBe("rejected_replay");
    }
  });
});

describe("evaluateIngest — tenant isolation", () => {
  it("rejects when X-Harbor-Org claim mismatches", () => {
    const decision = evaluateIngest({
      request: baseRequest({ claimedWorkspaceId: "ws_other" }),
      endpointSecret: SECRET,
      endpointWorkspaceId: WORKSPACE,
      recentDeliveries: [],
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.status).toBe("rejected_tenant");
    }
  });
});

describe("backoffDelayMs", () => {
  it("doubles each attempt and caps at 60s", () => {
    expect(backoffDelayMs(1)).toBe(1000);
    expect(backoffDelayMs(2)).toBe(2000);
    expect(backoffDelayMs(3)).toBe(4000);
    expect(backoffDelayMs(10)).toBe(60_000);
  });
});

describe("appendReplayEntry", () => {
  it("prunes entries outside the window", () => {
    const now = 1_000_000;
    const pruned = appendReplayEntry(
      [
        { deliveryId: "old", endpointId: ENDPOINT, seenAt: now - 999_999 },
        { deliveryId: "keep", endpointId: ENDPOINT, seenAt: now - 10 },
      ],
      { deliveryId: "new", endpointId: ENDPOINT, seenAt: now },
      now,
      60_000
    );
    expect(pruned.map((e) => e.deliveryId)).toEqual(["keep", "new"]);
  });
});
