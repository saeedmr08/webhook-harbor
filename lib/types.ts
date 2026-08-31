/** Shared domain types for WebhookHarbor. */

export type DeliveryStatus =
  | "accepted"
  | "rejected_signature"
  | "rejected_replay"
  | "rejected_tenant"
  | "failed"
  | "replayed";

export interface Workspace {
  id: string;
  name: string;
  createdAt: number;
}

export interface HarborEndpoint {
  id: string;
  workspaceId: string;
  /** Shared secret kept only in process memory for this demo. */
  secret: string;
  label: string;
  createdAt: number;
  expiresAt: number;
}

export interface IngestedDelivery {
  id: string;
  endpointId: string;
  workspaceId: string;
  deliveryId: string;
  receivedAt: number;
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
  bodyBytes: number;
  status: DeliveryStatus;
  signatureValid: boolean | null;
  rejectReason?: string;
  retryCount: number;
  nextRetryAt: number | null;
  lastError?: string;
}

export interface IngestRequest {
  endpointId: string;
  workspaceId: string;
  deliveryId: string;
  rawBody: string;
  signatureHeader: string | undefined;
  headers: Record<string, string>;
  method: string;
  path: string;
  claimedWorkspaceId: string | undefined;
}

export type IngestDecision =
  | { ok: true; status: "accepted" }
  | {
      ok: false;
      status: Exclude<DeliveryStatus, "accepted" | "replayed">;
      reason: string;
    };

export interface ReplayWindowEntry {
  deliveryId: string;
  endpointId: string;
  seenAt: number;
}
