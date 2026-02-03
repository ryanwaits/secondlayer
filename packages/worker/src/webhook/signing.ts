import { createSignatureHeader } from "@secondlayer/shared/crypto/hmac";

/**
 * Create headers for a signed webhook request
 * Uses Stripe-style signature format: t=timestamp,v1=signature
 */
export function createWebhookHeaders(
  payload: string,
  secret: string | null
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "Second-Layer/1.0",
  };

  if (secret) {
    const signature = createSignatureHeader(payload, secret);
    headers["X-Secondlayer-Signature"] = signature;
  }

  return headers;
}

/**
 * Sign a webhook payload and return the signature header value
 */
export function signWebhook(payload: string, secret: string): string {
  return createSignatureHeader(payload, secret);
}
