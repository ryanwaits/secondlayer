import type { Context } from "hono";

/** Extract the client IP from a Hono context, checking proxy headers first. */
export function getClientIp(c: Context): string {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("cf-connecting-ip") ||
    "unknown"
  );
}
