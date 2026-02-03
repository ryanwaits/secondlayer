import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "@secondlayer/shared/db";
import { generateApiKey } from "./keys.ts";
import { requireAuth } from "./middleware.ts";

const CreateKeySchema = z.object({
  name: z.string().max(255).optional(),
});

const app = new Hono();

// Create key (requires auth — tied to account)
app.post("/", requireAuth(), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = CreateKeySchema.parse(body);
  const accountId = (c as any).get("accountId");

  const db = getDb();
  const { raw, hash, prefix } = generateApiKey();

  const key = await db
    .insertInto("api_keys")
    .values({
      key_hash: hash,
      key_prefix: prefix,
      name: parsed.name ?? null,
      ip_address: getClientIp(c),
      account_id: accountId,
      status: "active",
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return c.json(
    {
      key: raw,
      prefix,
      id: key.id,
      createdAt: key.created_at.toISOString(),
    },
    201,
  );
});

// List keys (requires auth, scoped to account)
app.get("/", requireAuth(), async (c) => {
  const accountId = (c as any).get("accountId");
  const db = getDb();

  const keys = await db
    .selectFrom("api_keys")
    .select(["id", "key_prefix", "name", "status", "created_at", "last_used_at"])
    .where("account_id", "=", accountId)
    .orderBy("created_at", "desc")
    .execute();

  return c.json({
    keys: keys.map((k) => ({
      id: k.id,
      prefix: k.key_prefix,
      name: k.name,
      status: k.status,
      createdAt: k.created_at.toISOString(),
      lastUsedAt: k.last_used_at?.toISOString() ?? null,
    })),
  });
});

// Revoke key (requires auth, same account)
app.delete("/:id", requireAuth(), async (c) => {
  const { id } = c.req.param();
  const accountId = (c as any).get("accountId");
  const db = getDb();

  const target = await db
    .selectFrom("api_keys")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();

  if (!target) {
    return c.json({ error: "Key not found" }, 404);
  }

  if (target.account_id !== accountId) {
    return c.json({ error: "Cannot revoke keys from a different account" }, 403);
  }

  await db
    .updateTable("api_keys")
    .set({ status: "revoked", revoked_at: new Date() })
    .where("id", "=", id)
    .execute();

  return c.json({ revoked: true, id });
});

function getClientIp(c: any): string {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("cf-connecting-ip") ||
    "unknown"
  );
}

export default app;
