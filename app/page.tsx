"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Workspace = { id: string; name: string; createdAt: number };

type PublicEndpoint = {
  id: string;
  workspaceId: string;
  label: string;
  createdAt: number;
  expiresAt: number;
  ingestPath: string;
  secret?: string;
};

type Delivery = {
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
  status: string;
  signatureValid: boolean | null;
  rejectReason?: string;
  retryCount: number;
  nextRetryAt: number | null;
  lastError?: string;
};

function stampClass(status: string): string {
  if (status === "accepted" || status === "replayed") return "ok";
  if (status === "failed") return "warn";
  if (status.startsWith("rejected")) return "bad";
  return "neutral";
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

const SAMPLE_BODY = '{"event":"berth.arrived","cargo":"timber"}';

async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const buf = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default function HarborPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string>("");
  const [endpoints, setEndpoints] = useState<PublicEndpoint[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [label, setLabel] = useState("North Pier temporary");
  const [createdSecret, setCreatedSecret] = useState<PublicEndpoint | null>(
    null
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newQuayName, setNewQuayName] = useState("");
  const [copiedCurl, setCopiedCurl] = useState(false);
  const [ingestNote, setIngestNote] = useState<string | null>(null);
  const [lastSample, setLastSample] = useState<{
    deliveryId: string;
    body: string;
  } | null>(null);

  const refresh = useCallback(async (wsId?: string) => {
    const wsRes = await fetch("/api/workspaces");
    const wsJson = (await wsRes.json()) as { workspaces: Workspace[] };
    setWorkspaces(wsJson.workspaces);
    const active =
      wsId && wsJson.workspaces.some((w) => w.id === wsId)
        ? wsId
        : wsJson.workspaces[0]?.id;
    if (!active) return;
    setWorkspaceId(active);

    const [epRes, dlvRes] = await Promise.all([
      fetch(`/api/endpoints?workspaceId=${encodeURIComponent(active)}`),
      fetch(`/api/deliveries?workspaceId=${encodeURIComponent(active)}`),
    ]);
    const epJson = (await epRes.json()) as { endpoints: PublicEndpoint[] };
    const dlvJson = (await dlvRes.json()) as { deliveries: Delivery[] };
    setEndpoints(epJson.endpoints);
    setDeliveries(dlvJson.deliveries);
  }, []);

  useEffect(() => {
    void refresh().catch((e) =>
      setError(e instanceof Error ? e.message : "Load failed")
    );
    const timer = setInterval(() => {
      void refresh(workspaceId || undefined);
    }, 4000);
    return () => clearInterval(timer);
  }, [refresh, workspaceId]);

  const activeEndpoint = createdSecret ?? endpoints[0] ?? null;

  const curlExample = useMemo(() => {
    if (!activeEndpoint?.id) {
      return "# Create a berth first, then POST to /api/ingest/<endpointId>";
    }
    const secret = activeEndpoint.secret ?? "<SECRET_FROM_CREATE>";
    return `BODY='${SAMPLE_BODY}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac '${secret}' | awk '{print $2}')
curl -sS -X POST "http://localhost:3000${activeEndpoint.ingestPath}" \\
  -H "Content-Type: application/json" \\
  -H "X-Harbor-Signature: $SIG" \\
  -H "X-Harbor-Delivery-Id: $(uuidgen)" \\
  -H "X-Harbor-Org: ${activeEndpoint.workspaceId}" \\
  -H "Authorization: Bearer demo-token-do-not-log" \\
  -H "Cookie: session=demo" \\
  --data "$BODY"`;
  }, [activeEndpoint]);

  async function createEndpoint() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/endpoints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, label }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Create failed");
      setCreatedSecret(json.endpoint as PublicEndpoint);
      await refresh(workspaceId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function createWorkspace() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newQuayName || "Secondary Quay" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Workspace create failed");
      setNewQuayName("");
      await refresh((json.workspace as Workspace).id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Workspace create failed");
    } finally {
      setBusy(false);
    }
  }

  async function replay(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/deliveries/${id}/replay`, { method: "POST" });
      await refresh(workspaceId);
    } finally {
      setBusy(false);
    }
  }

  async function retry(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/deliveries/${id}/retry`, { method: "POST" });
      await refresh(workspaceId);
    } finally {
      setBusy(false);
    }
  }

  async function copyCurl() {
    try {
      await navigator.clipboard.writeText(curlExample);
      setCopiedCurl(true);
      setTimeout(() => setCopiedCurl(false), 1600);
    } catch {
      setError("Could not copy curl");
    }
  }

  async function sendSignedSample(replay: boolean) {
    const secret = createdSecret?.secret;
    const path = createdSecret?.ingestPath ?? activeEndpoint?.ingestPath;
    const org = createdSecret?.workspaceId ?? activeEndpoint?.workspaceId;
    if (!secret || !path) {
      setError(
        "Assign a temporary endpoint first — the signing secret is shown once at create."
      );
      return;
    }
    if (replay && !lastSample) {
      setError("Send a signed sample first, then replay the same delivery-id.");
      return;
    }
    setBusy(true);
    setError(null);
    setIngestNote(null);
    try {
      const body = replay && lastSample ? lastSample.body : SAMPLE_BODY;
      const deliveryId =
        replay && lastSample ? lastSample.deliveryId : crypto.randomUUID();
      const signature = await hmacSha256Hex(secret, body);
      const res = await fetch(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Harbor-Signature": signature,
          "X-Harbor-Delivery-Id": deliveryId,
          "X-Harbor-Org": org ?? "",
        },
        body,
      });
      const json = (await res.json().catch(() => ({}))) as {
        status?: string;
        deliveryId?: string;
        rejectReason?: string | null;
        error?: string;
      };
      if (!replay) {
        setLastSample({ deliveryId, body });
      }
      if (res.status === 409) {
        setIngestNote(
          `409 — duplicate delivery-id ${deliveryId} rejected (replay protection).`
        );
      } else if (res.ok) {
        setIngestNote(
          `Accepted ${json.deliveryId ?? deliveryId} (${json.status ?? res.status}). Persists in data/harbor.json.`
        );
      } else {
        setIngestNote(
          `${res.status} — ${json.rejectReason ?? json.error ?? json.status ?? "ingest failed"}`
        );
      }
      await refresh(workspaceId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Signed sample failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <header className="masthead">
        <h1 className="brand">
          Webhook<span>Harbor</span>
        </h1>
        <p className="tagline">
          Temporary berths for inbound webhooks — verify HMAC manifests, reject
          replayed bills of lading, inspect cargo, and simulate retry tides.
        </p>
      </header>

      <div className="manifest-bar">
        <span>
          Operator <strong>Saeed Rumaneh</strong>
        </span>
        <span>
          Mode <strong>In-memory demo</strong>
        </span>
        <span>
          Scheme <strong>HMAC-SHA256</strong>
        </span>
        <span>
          Replay window <strong>5 min</strong>
        </span>
      </div>

      {error ? (
        <p className="empty" role="alert">
          {error}
        </p>
      ) : null}

      <div className="deck">
        <section className="panel">
          <h2>Open a berth</h2>
          <p className="lede">
            Mint a temporary endpoint id. The shared secret stays in process
            memory and is shown once at creation.
          </p>

          <div className="field">
            <label htmlFor="workspace">Quay (workspace)</label>
            <select
              id="workspace"
              value={workspaceId}
              onChange={(e) => {
                setWorkspaceId(e.target.value);
                void refresh(e.target.value);
              }}
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.id})
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="new-quay">Add quay</label>
            <input
              id="new-quay"
              value={newQuayName}
              onChange={(e) => setNewQuayName(e.target.value)}
              placeholder="East Basin"
            />
          </div>
          <div className="actions">
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => void createWorkspace()}
            >
              Register quay
            </button>
          </div>

          <div className="field" style={{ marginTop: "1rem" }}>
            <label htmlFor="label">Berth label</label>
            <input
              id="label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="actions">
            <button
              type="button"
              disabled={busy || !workspaceId}
              onClick={() => void createEndpoint()}
            >
              Assign temporary endpoint
            </button>
          </div>

          {createdSecret?.secret ? (
            <div className="secret-box">
              <span className="label">Manifest secret (memory only)</span>
              <div>Endpoint: {createdSecret.id}</div>
              <div>Path: {createdSecret.ingestPath}</div>
              <div>Secret: {createdSecret.secret}</div>
            </div>
          ) : null}

          <h2 style={{ marginTop: "1.5rem" }}>Active berths</h2>
          {endpoints.length === 0 ? (
            <p className="empty">No open berths on this quay.</p>
          ) : (
            <ul className="endpoint-list">
              {endpoints.map((ep) => (
                <li key={ep.id}>
                  <div>
                    <strong>{ep.label}</strong>
                  </div>
                  <div className="mono">{ep.id}</div>
                  <div className="meta-row">
                    <span>Ingest {ep.ingestPath}</span>
                    <span>Expires {formatTime(ep.expiresAt)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="curl-hint">
            <strong>Sample dispatch</strong>
            <p className="lede">
              Signed POSTs go to the ingest path with HMAC headers. State lives in{" "}
              <code>data/harbor.json</code>.
            </p>
            <div className="actions">
              <button
                type="button"
                disabled={busy || !createdSecret?.secret}
                onClick={() => void sendSignedSample(false)}
              >
                Send signed sample
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy || !lastSample}
                onClick={() => void sendSignedSample(true)}
              >
                Replay last delivery-id
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => void copyCurl()}
              >
                {copiedCurl ? "Copied" : "Copy curl"}
              </button>
            </div>
            {ingestNote ? (
              <p className="empty" role="status">
                {ingestNote}
              </p>
            ) : null}
            <pre>{curlExample}</pre>
          </div>
        </section>

        <section className="panel">
          <h2>Shipping log</h2>
          <p className="lede">
            Inbound deliveries with redacted Authorization / Cookie headers.
            Failed rows expose retry/backoff simulation.
          </p>

          {deliveries.length === 0 ? (
            <p className="empty">Harbor is quiet — no manifests logged yet.</p>
          ) : (
            <ul className="delivery-list">
              {deliveries.map((d) => (
                <li
                  key={d.id}
                  className="delivery-card"
                  data-status={d.status}
                >
                  <div>
                    <span className={`stamp ${stampClass(d.status)}`}>
                      {d.status}
                    </span>
                    <span className="mono">{d.id}</span>
                  </div>
                  <div className="meta-row">
                    <span>Delivery-Id {d.deliveryId}</span>
                    <span>{formatTime(d.receivedAt)}</span>
                    <span>{d.bodyBytes} B</span>
                    {d.signatureValid === true ? (
                      <span>sig ok</span>
                    ) : d.signatureValid === false ? (
                      <span>sig fail</span>
                    ) : null}
                    {d.retryCount > 0 ? (
                      <span>retries {d.retryCount}</span>
                    ) : null}
                  </div>
                  {d.rejectReason || d.lastError ? (
                    <div className="meta-row">
                      {d.rejectReason ?? d.lastError}
                      {d.nextRetryAt
                        ? ` · next retry ${formatTime(d.nextRetryAt)}`
                        : ""}
                    </div>
                  ) : null}
                  <table className="headers-table">
                    <thead>
                      <tr>
                        <th>Header</th>
                        <th>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(d.headers).map(([k, v]) => (
                        <tr key={k}>
                          <td>{k}</td>
                          <td
                            className={
                              v === "[REDACTED]" ? "redacted" : undefined
                            }
                          >
                            {v}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <pre className="payload">{d.body || "(empty body)"}</pre>
                  <div className="actions">
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => void replay(d.id)}
                    >
                      Replay
                    </button>
                    {d.status === "failed" ? (
                      <button
                        type="button"
                        className="rust"
                        disabled={busy}
                        onClick={() => void retry(d.id)}
                      >
                        Simulate retry
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <p className="footer-note">
        WebhookHarbor · portfolio project by Saeed Rumaneh · secrets never leave
        process memory · MIT 2026
      </p>
    </main>
  );
}
