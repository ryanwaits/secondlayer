import { createHmac, randomBytes } from "crypto";

/**
 * Generate a random secret for webhook signing
 * Returns 32 bytes as a 64-character hex string
 */
export function generateSecret(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Sign a payload with HMAC-SHA256
 * Returns the signature as a hex string
 */
export function signPayload(payload: string, secret: string): string {
  const hmac = createHmac("sha256", secret);
  hmac.update(payload);
  return hmac.digest("hex");
}

/**
 * Verify an HMAC signature
 * Uses constant-time comparison to prevent timing attacks
 */
export function verifySignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expectedSignature = signPayload(payload, secret);

  // Constant-time comparison
  if (signature.length !== expectedSignature.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < signature.length; i++) {
    result |= signature.charCodeAt(i) ^ expectedSignature.charCodeAt(i);
  }

  return result === 0;
}

/**
 * Create a Stripe-style signature header
 * Format: t=timestamp,v1=signature
 */
export function createSignatureHeader(
  payload: string,
  secret: string,
  timestamp?: number
): string {
  const ts = timestamp ?? Math.floor(Date.now() / 1000);
  const signedPayload = `${ts}.${payload}`;
  const signature = signPayload(signedPayload, secret);

  return `t=${ts},v1=${signature}`;
}

/**
 * Parse and verify a Stripe-style signature header
 * Returns true if valid, false otherwise
 */
export function verifySignatureHeader(
  payload: string,
  header: string,
  secret: string,
  toleranceSeconds = 300 // 5 minutes
): boolean {
  // Parse header
  const parts = header.split(",");
  const timestamp = parts
    .find((p) => p.startsWith("t="))
    ?.slice(2);
  const signature = parts
    .find((p) => p.startsWith("v1="))
    ?.slice(3);

  if (!timestamp || !signature) {
    return false;
  }

  const ts = parseInt(timestamp, 10);
  if (isNaN(ts)) {
    return false;
  }

  // Check timestamp is within tolerance
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > toleranceSeconds) {
    return false;
  }

  // Verify signature
  const signedPayload = `${ts}.${payload}`;
  return verifySignature(signedPayload, signature, secret);
}
