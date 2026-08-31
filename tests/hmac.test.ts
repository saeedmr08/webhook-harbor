import { describe, expect, it } from "vitest";
import {
  normalizeSignature,
  safeEqualHex,
  signBody,
  verifyHmacSha256,
} from "../lib/hmac";

describe("signBody", () => {
  it("produces a stable hex digest for known inputs", () => {
    const digest = signBody("harbor-secret", '{"event":"berth.arrived"}');
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(signBody("harbor-secret", '{"event":"berth.arrived"}')).toBe(digest);
  });

  it("changes when the secret or body changes", () => {
    const base = signBody("secret-a", "payload");
    expect(signBody("secret-b", "payload")).not.toBe(base);
    expect(signBody("secret-a", "other")).not.toBe(base);
  });
});

describe("safeEqualHex", () => {
  it("returns true for identical strings", () => {
    expect(safeEqualHex("abc123", "abc123")).toBe(true);
  });

  it("returns false for different values or lengths", () => {
    expect(safeEqualHex("abc123", "abc124")).toBe(false);
    expect(safeEqualHex("short", "longer")).toBe(false);
  });
});

describe("normalizeSignature", () => {
  it("strips sha256= and v1= prefixes", () => {
    expect(normalizeSignature("sha256=deadbeef")).toBe("deadbeef");
    expect(normalizeSignature("v1=cafebabe")).toBe("cafebabe");
    expect(normalizeSignature("plainhex")).toBe("plainhex");
  });

  it("returns null for empty headers", () => {
    expect(normalizeSignature(undefined)).toBeNull();
    expect(normalizeSignature("")).toBeNull();
    expect(normalizeSignature("   ")).toBeNull();
  });
});

describe("verifyHmacSha256", () => {
  const secret = "quay-shared-secret";
  const body = JSON.stringify({ shipment: "MH-2041", status: "cleared" });

  it("accepts a valid signature (raw hex)", () => {
    const expected = signBody(secret, body);
    const result = verifyHmacSha256(secret, body, expected);
    expect(result.valid).toBe(true);
    expect(result.provided).toBe(expected);
  });

  it("accepts sha256= prefixed signatures", () => {
    const expected = signBody(secret, body);
    const result = verifyHmacSha256(secret, body, `sha256=${expected}`);
    expect(result.valid).toBe(true);
  });

  it("rejects an invalid signature", () => {
    const result = verifyHmacSha256(
      secret,
      body,
      "0000000000000000000000000000000000000000000000000000000000000000"
    );
    expect(result.valid).toBe(false);
  });

  it("rejects a missing signature", () => {
    const result = verifyHmacSha256(secret, body, undefined);
    expect(result.valid).toBe(false);
    expect(result.provided).toBeNull();
  });

  it("rejects a signature for a tampered body", () => {
    const expected = signBody(secret, body);
    const result = verifyHmacSha256(secret, body + " ", expected);
    expect(result.valid).toBe(false);
  });
});
