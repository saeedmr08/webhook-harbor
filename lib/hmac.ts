import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Compute HMAC-SHA256 hex digest of a raw body with the shared secret.
 */
export function signBody(secret: string, rawBody: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

/**
 * Timing-safe comparison of two hex digests.
 * Returns false when lengths differ (avoids throwing from timingSafeEqual).
 */
export function safeEqualHex(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a, "utf8");
    const bufB = Buffer.from(b, "utf8");
    if (bufA.length !== bufB.length) {
      return false;
    }
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/**
 * Normalize common signature header formats:
 * - raw hex
 * - "sha256=<hex>"
 * - "v1=<hex>"
 */
export function normalizeSignature(header: string | undefined): string | null {
  if (!header || !header.trim()) {
    return null;
  }
  const trimmed = header.trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("sha256=")) {
    return trimmed.slice(7).trim();
  }
  if (lower.startsWith("v1=")) {
    return trimmed.slice(3).trim();
  }
  return trimmed;
}

/**
 * Verify an inbound webhook signature against the endpoint secret.
 */
export function verifyHmacSha256(
  secret: string,
  rawBody: string,
  signatureHeader: string | undefined
): { valid: boolean; expected: string; provided: string | null } {
  const expected = signBody(secret, rawBody);
  const provided = normalizeSignature(signatureHeader);
  if (provided === null) {
    return { valid: false, expected, provided: null };
  }
  return {
    valid: safeEqualHex(expected, provided),
    expected,
    provided,
  };
}
