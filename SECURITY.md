# Security Policy

## Scope

WebhookHarbor is a **portfolio / demo** tool. It stores endpoint shared secrets and
delivery payloads in **process memory only**. Do not point production traffic at
it or reuse demo secrets outside a local session.

## Reporting a vulnerability

If you discover a security issue in this project, please email the author
(**Saeed Rumaneh**) privately. Please include:

- A short description of the issue
- Steps to reproduce
- Impact assessment (e.g. signature bypass, cross-tenant read)

Please allow reasonable time for a fix before public disclosure.

## Hardening notes for real deployments

This demo intentionally omits durable storage, distributed replay locks, and
secret managers. A production webhook receiver should at least:

1. Keep HMAC secrets in a vault / KMS — never in logs or client bundles.
2. Verify signatures with a timing-safe compare (see `lib/hmac.ts`).
3. Enforce delivery-id replay windows with a shared store (Redis, etc.).
4. Isolate tenants strictly by authenticated org context, not only headers.
5. Redact `Authorization`, `Cookie`, and similar headers in any UI or logs.
6. Rate-limit ingest paths and reject oversized bodies early.
