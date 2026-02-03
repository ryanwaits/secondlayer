import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "@secondlayer/shared/db";
import { ValidationError } from "@secondlayer/shared/errors";
import { generateSessionToken, hashToken } from "@secondlayer/auth/keys";
import { sendMagicLink } from "@secondlayer/auth/email";
import {
  createMagicLink,
  verifyMagicLink,
  upsertAccount,
} from "@secondlayer/shared/db/queries/accounts";

const app = new Hono();

const MagicLinkSchema = z.object({
  email: z.string().email(),
});

const VerifySchema = z.object({
  token: z.string().min(1),
});

// Request magic link (no auth)
app.post("/magic-link", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: "Invalid JSON body" }, 400);

  const parsed = MagicLinkSchema.parse(body);
  const db = getDb();

  const token = crypto.randomUUID();
  await createMagicLink(db, parsed.email, token);
  await sendMagicLink(parsed.email, token);

  return c.json({ message: "Magic link sent. Check your email." });
});

// Verify token → create account + session token (no auth)
app.post("/verify", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: "Invalid JSON body" }, 400);

  const parsed = VerifySchema.parse(body);
  const db = getDb();

  const email = await verifyMagicLink(db, parsed.token);
  if (!email) {
    throw new ValidationError("Invalid or expired token");
  }

  const account = await upsertAccount(db, email);

  // Create session token
  const { raw, hash, prefix } = generateSessionToken();
  await db
    .insertInto("sessions")
    .values({
      token_hash: hash,
      token_prefix: prefix,
      account_id: account.id,
      ip_address: getClientIp(c),
    })
    .execute();

  return c.json({
    sessionToken: raw,
    account: {
      id: account.id,
      email: account.email,
      plan: account.plan,
    },
  });
});

// Logout — revoke session (requires auth, handled by middleware)
app.post("/logout", async (c) => {
  const authHeader = c.req.header("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Missing authorization" }, 401);
  }

  const raw = authHeader.slice(7);
  if (!raw.startsWith("ss-sl_")) {
    return c.json({ error: "Logout requires a session token" }, 400);
  }

  const tokenHash = hashToken(raw);
  const db = getDb();

  await db
    .updateTable("sessions")
    .set({ revoked_at: new Date() })
    .where("token_hash", "=", tokenHash)
    .execute();

  return c.json({ message: "Logged out" });
});

function getClientIp(c: any): string {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("cf-connecting-ip") ||
    "unknown"
  );
}

export default app;
