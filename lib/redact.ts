const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "proxy-authorization",
]);

/**
 * Redact Authorization / Cookie (and related) headers for safe UI display.
 * Matching is case-insensitive on header names.
 */
export function redactHeaders(
  headers: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (SENSITIVE_HEADER_NAMES.has(key.toLowerCase())) {
      out[key] = "[REDACTED]";
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function isSensitiveHeader(name: string): boolean {
  return SENSITIVE_HEADER_NAMES.has(name.toLowerCase());
}
