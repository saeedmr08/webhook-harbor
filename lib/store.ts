import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  appendReplayEntry,
  backoffDelayMs,
  DEFAULT_REPLAY_WINDOW_MS,
  evaluateIngest,
} from "./ingest-policy";
import { redactHeaders } from "./redact";
import type {
  HarborEndpoint,
  IngestedDelivery,
  ReplayWindowEntry,
  Workspace,
} from "./types";

const ENDPOINT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DATA_FILE = path.join(process.cwd(), "data", "harbor.json");
const MAX_RETRIES = Number(process.env.WEBHOOK_HARBOR_MAX_RETRIES ?? 5);
const REPLAY_WINDOW_MS = Number(
  process.env.WEBHOOK_HARBOR_REPLAY_WINDOW_MS ?? DEFAULT_REPLAY_WINDOW_MS
);

/**
 * Process-local demo store. Secrets never leave memory.
 * Survives only for the life of the Node process (dev / single instance).
 */
class HarborStore {
  private workspaces = new Map<string, Workspace>();
  private endpoints = new Map<string, HarborEndpoint>();
  private deliveries = new Map<string, IngestedDelivery>();
  private replayLog: ReplayWindowEntry[] = [];

  constructor() {
    this.hydrate();
  }

  private hydrate(): void {
    try {
      const snapshot = JSON.parse(readFileSync(DATA_FILE, "utf8")) as {
        workspaces?: Workspace[];
        endpoints?: HarborEndpoint[];
        deliveries?: IngestedDelivery[];
        replayLog?: ReplayWindowEntry[];
      };
      for (const workspace of snapshot.workspaces ?? []) {
        this.workspaces.set(workspace.id, workspace);
      }
      for (const endpoint of snapshot.endpoints ?? []) {
        this.endpoints.set(endpoint.id, endpoint);
      }
      for (const delivery of snapshot.deliveries ?? []) {
        this.deliveries.set(delivery.id, delivery);
      }
      this.replayLog = snapshot.replayLog ?? [];
    } catch {
      // First boot uses an empty store; demo workspace is created on demand.
    }
  }

  private persist(): void {
    mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    writeFileSync(
      DATA_FILE,
      `${JSON.stringify(
        {
          workspaces: [...this.workspaces.values()],
          endpoints: [...this.endpoints.values()],
          deliveries: [...this.deliveries.values()],
          replayLog: this.replayLog,
        },
        null,
        2,
      )}\n`,
    );
  }

  ensureDemoWorkspace(name = "Default Quay"): Workspace {
    for (const ws of this.workspaces.values()) {
      if (ws.name === name) {
        return ws;
      }
    }
    const ws: Workspace = {
      id: `ws_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
      name,
      createdAt: Date.now(),
    };
    this.workspaces.set(ws.id, ws);
    this.persist();
    return ws;
  }

  listWorkspaces(): Workspace[] {
    return [...this.workspaces.values()].sort(
      (a, b) => b.createdAt - a.createdAt
    );
  }

  getWorkspace(id: string): Workspace | undefined {
    return this.workspaces.get(id);
  }

  createWorkspace(name: string): Workspace {
    const ws: Workspace = {
      id: `ws_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
      name: name.trim() || "Unnamed Quay",
      createdAt: Date.now(),
    };
    this.workspaces.set(ws.id, ws);
    this.persist();
    return ws;
  }

  createEndpoint(options: {
    workspaceId: string;
    label?: string;
    secret?: string;
  }): HarborEndpoint {
    const workspace = this.workspaces.get(options.workspaceId);
    if (!workspace) {
      throw new Error("Unknown workspace");
    }
    const now = Date.now();
    const secret =
      options.secret?.trim() ||
      process.env.WEBHOOK_HARBOR_DEFAULT_SECRET ||
      randomBytes(24).toString("hex");
    const endpoint: HarborEndpoint = {
      id: `ep_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      workspaceId: options.workspaceId,
      secret,
      label: options.label?.trim() || "Temporary berth",
      createdAt: now,
      expiresAt: now + ENDPOINT_TTL_MS,
    };
    this.endpoints.set(endpoint.id, endpoint);
    this.persist();
    return endpoint;
  }

  getEndpoint(id: string): HarborEndpoint | undefined {
    const ep = this.endpoints.get(id);
    if (!ep) {
      return undefined;
    }
    if (ep.expiresAt < Date.now()) {
      this.endpoints.delete(id);
      return undefined;
    }
    return ep;
  }

  listEndpoints(workspaceId?: string): HarborEndpoint[] {
    const now = Date.now();
    const list: HarborEndpoint[] = [];
    for (const ep of this.endpoints.values()) {
      if (ep.expiresAt < now) {
        this.endpoints.delete(ep.id);
        continue;
      }
      if (workspaceId && ep.workspaceId !== workspaceId) {
        continue;
      }
      list.push(ep);
    }
    return list.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Public view of an endpoint — secret is returned only at creation time
   * via createEndpoint; list/get for UI omit it unless explicitly requested.
   */
  publicEndpoint(ep: HarborEndpoint, includeSecret = false) {
    return {
      id: ep.id,
      workspaceId: ep.workspaceId,
      label: ep.label,
      createdAt: ep.createdAt,
      expiresAt: ep.expiresAt,
      ingestPath: `/api/ingest/${ep.id}`,
      ...(includeSecret ? { secret: ep.secret } : {}),
    };
  }

  ingest(options: {
    endpointId: string;
    rawBody: string;
    headers: Record<string, string>;
    method: string;
    path: string;
  }): { delivery: IngestedDelivery; httpStatus: number } {
    const endpoint = this.getEndpoint(options.endpointId);
    if (!endpoint) {
      throw new Error("Endpoint not found or expired");
    }

    const headerMap = normalizeHeaderMap(options.headers);
    const deliveryId =
      headerMap["x-harbor-delivery-id"] ??
      headerMap["x-delivery-id"] ??
      "";
    const signatureHeader =
      headerMap["x-harbor-signature"] ??
      headerMap["x-hub-signature-256"] ??
      headerMap["x-signature"];
    const claimedWorkspaceId =
      headerMap["x-harbor-org"] ?? headerMap["x-harbor-workspace"];

    const decision = evaluateIngest({
      request: {
        endpointId: endpoint.id,
        workspaceId: endpoint.workspaceId,
        deliveryId,
        rawBody: options.rawBody,
        signatureHeader,
        headers: headerMap,
        method: options.method,
        path: options.path,
        claimedWorkspaceId,
      },
      endpointSecret: endpoint.secret,
      endpointWorkspaceId: endpoint.workspaceId,
      recentDeliveries: this.replayLog,
      replayWindowMs: REPLAY_WINDOW_MS,
    });

    const now = Date.now();
    const id = `dlv_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

    let status = decision.ok ? ("accepted" as const) : decision.status;
    let rejectReason = decision.ok ? undefined : decision.reason;
    let retryCount = 0;
    let nextRetryAt: number | null = null;
    let lastError: string | undefined;

    // Simulate a transient failure path when client asks for it.
    if (
      decision.ok &&
      (headerMap["x-harbor-force-fail"] === "1" ||
        headerMap["x-harbor-force-fail"] === "true")
    ) {
      status = "failed";
      lastError = "Simulated upstream failure (X-Harbor-Force-Fail)";
      retryCount = 0;
      nextRetryAt = now + backoffDelayMs(1);
      rejectReason = lastError;
    }

    if (decision.ok && status === "accepted") {
      this.replayLog = appendReplayEntry(
        this.replayLog,
        {
          deliveryId,
          endpointId: endpoint.id,
          seenAt: now,
        },
        now,
        REPLAY_WINDOW_MS
      );
    }

    const delivery: IngestedDelivery = {
      id,
      endpointId: endpoint.id,
      workspaceId: endpoint.workspaceId,
      deliveryId: deliveryId || "(missing)",
      receivedAt: now,
      method: options.method,
      path: options.path,
      headers: redactHeaders(headerMap),
      body: options.rawBody,
      bodyBytes: Buffer.byteLength(options.rawBody, "utf8"),
      status,
      signatureValid: decision.ok
        ? true
        : decision.status === "rejected_signature"
          ? false
          : null,
      rejectReason,
      retryCount,
      nextRetryAt,
      lastError,
    };

    this.deliveries.set(id, delivery);
    this.persist();

    const httpStatus = decision.ok
      ? status === "failed"
        ? 502
        : 200
      : decision.status === "rejected_signature"
        ? 401
        : decision.status === "rejected_replay"
          ? 409
          : decision.status === "rejected_tenant"
            ? 403
            : 400;

    return { delivery, httpStatus };
  }

  listDeliveries(filters?: {
    workspaceId?: string;
    endpointId?: string;
  }): IngestedDelivery[] {
    let list = [...this.deliveries.values()];
    if (filters?.workspaceId) {
      list = list.filter((d) => d.workspaceId === filters.workspaceId);
    }
    if (filters?.endpointId) {
      list = list.filter((d) => d.endpointId === filters.endpointId);
    }
    return list.sort((a, b) => b.receivedAt - a.receivedAt);
  }

  getDelivery(id: string): IngestedDelivery | undefined {
    return this.deliveries.get(id);
  }

  /**
   * Mark a delivery as manually replayed (inspection / re-dispatch stub).
   */
  replayDelivery(id: string): IngestedDelivery {
    const existing = this.deliveries.get(id);
    if (!existing) {
      throw new Error("Delivery not found");
    }
    const clone: IngestedDelivery = {
      ...existing,
      id: `dlv_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      receivedAt: Date.now(),
      status: "replayed",
      rejectReason: undefined,
      lastError: undefined,
      retryCount: 0,
      nextRetryAt: null,
      deliveryId: `${existing.deliveryId}#replay-${Date.now()}`,
    };
    this.deliveries.set(clone.id, clone);
    this.persist();
    return clone;
  }

  /**
   * Advance retry/backoff simulation for a failed delivery.
   */
  simulateRetry(id: string): IngestedDelivery {
    const delivery = this.deliveries.get(id);
    if (!delivery) {
      throw new Error("Delivery not found");
    }
    if (delivery.status !== "failed") {
      throw new Error("Only failed deliveries can be retried");
    }
    const attempt = delivery.retryCount + 1;
    if (attempt > MAX_RETRIES) {
      delivery.lastError = `Exhausted ${MAX_RETRIES} retry attempts`;
      delivery.nextRetryAt = null;
      this.deliveries.set(id, delivery);
      this.persist();
      return delivery;
    }

    delivery.retryCount = attempt;
    // Odd attempts keep failing; even attempts succeed — makes backoff visible.
    if (attempt % 2 === 0) {
      delivery.status = "accepted";
      delivery.lastError = undefined;
      delivery.nextRetryAt = null;
      delivery.rejectReason = undefined;
    } else {
      delivery.lastError = `Simulated retry failure (attempt ${attempt})`;
      delivery.nextRetryAt = Date.now() + backoffDelayMs(attempt + 1);
    }
    this.deliveries.set(id, delivery);
    this.persist();
    return delivery;
  }
}

function normalizeHeaderMap(
  headers: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k.toLowerCase()] = v;
  }
  return out;
}

/** Singleton for route handlers / UI server components. */
const globalForHarbor = globalThis as unknown as {
  __webhookHarborStore?: HarborStore;
};

export const harborStore =
  globalForHarbor.__webhookHarborStore ?? new HarborStore();

if (process.env.NODE_ENV !== "production") {
  globalForHarbor.__webhookHarborStore = harborStore;
}

export { HarborStore, MAX_RETRIES, REPLAY_WINDOW_MS, ENDPOINT_TTL_MS };
