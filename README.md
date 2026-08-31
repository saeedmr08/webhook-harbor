# WebhookHarbor

Portfolio project by **Saeed Rumaneh** — a small harbor for inbound webhooks.

Receive temporary endpoint traffic, verify **HMAC-SHA256** signatures (timing-safe),
reject **replayed delivery IDs**, redact sensitive headers in the UI, and simulate
**retry / exponential backoff** for failed deliveries. Workspaces (“quays”) provide
simple tenant isolation via an org header.

## Stack

- Next.js 15 (App Router) UI + route handlers
- TypeScript domain layer under `lib/`
- JSON file store at `data/harbor.json` (gitignored)
- Vitest for HMAC + ingest policy tests

## Features

| Capability | Behavior |
|---|---|
| Temporary endpoints | Create a berth; lives 7 days and survives restarts |
| Ingest | `POST /api/ingest/:endpointId` with body + headers |
| HMAC | `X-Harbor-Signature` = hex HMAC-SHA256 of raw body |
| Replay protection | Duplicate `X-Harbor-Delivery-Id` within the window → 409 |
| Tenant check | Optional `X-Harbor-Org` must match endpoint workspace |
| Redaction | `Authorization` / `Cookie` shown as `[REDACTED]` |
| Retry simulation | Send `X-Harbor-Force-Fail: 1`, then use **Simulate retry** |

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), assign a temporary endpoint,
copy the in-memory secret, and dispatch with the sample `curl` from the UI.

```bash
npm test
npm run typecheck
npm run build
```

## Domain layout

- `lib/hmac.ts` — sign, normalize, timing-safe verify
- `lib/ingest-policy.ts` — accept / reject decision + backoff helpers
- `lib/redact.ts` — header redaction for display
- `lib/store.ts` — in-memory workspaces, endpoints, deliveries
- `tests/` — vitest coverage for valid signature, invalid signature, replay

## Environment

Copy `.env.example` if you want optional overrides. Placeholders only — no real secrets.

## Complete product flows

1. Assign a temporary berth, then click **Send signed sample** — the UI POSTs to the ingest path with HMAC headers. State lives in `data/harbor.json`.
2. The shipping log shows an accepted delivery (Authorization / Cookie redacted).
3. Click **Replay last delivery-id** — ingest returns 409 for the duplicate delivery id.

## License

MIT © 2026 Saeed Rumaneh — see [LICENSE](./LICENSE).

Security expectations: [SECURITY.md](./SECURITY.md).
