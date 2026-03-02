import { createHmac } from "crypto";

const MAX_TIMESTAMP_DRIFT_S = 300; // 5 minutes

/** Verify Slack request signature (HMAC-SHA256). */
export function verifySlackSignature(
  signingSecret: string,
  signature: string,
  timestamp: string,
  body: string
): boolean {
  if (!signingSecret || !signature || !timestamp) return false;

  // Reject replay attacks
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > MAX_TIMESTAMP_DRIFT_S) return false;

  const basestring = `v0:${timestamp}:${body}`;
  const expected = "v0=" + createHmac("sha256", signingSecret).update(basestring).digest("hex");

  // Timing-safe comparison
  if (signature.length !== expected.length) return false;
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  try {
    const { timingSafeEqual } = require("crypto");
    return timingSafeEqual(sigBuf, expBuf);
  } catch {
    return signature === expected;
  }
}
