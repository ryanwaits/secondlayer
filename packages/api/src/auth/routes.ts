import { getDb } from "@secondlayer/shared/db";
import { ValidationError } from "@secondlayer/shared/errors";
import { Hono } from "hono";
import { z } from "zod";
import { getClientIp } from "./http.ts";
import { requireAuth } from "./middleware.ts";
import { assertCanMint, mintApiKey, resolveMintProduct } from "./mint.ts";

// No tier field: every key mints at the single metered tier (see mint.ts).
// A legacy `tier` in the body is silently stripped by zod.
// `product` stays on the wire so old dashboard clients don't 400 on an
// unknown field. Agents should omit it (schema defaults to account).
export const CreateKeySchema = z.object({
	name: z.string().max(255).optional(),
	product: z.enum(["account", "streams", "index"]).default("account"),
});

const app = new Hono();

// Create key (requires auth — tied to account). Owner-gated: only a dashboard
// session or an account-product key may mint. Sessions may still mint
// streams/index (dashboard). API-key callers mint account keys only —
// agents should omit `product`. Requesting streams/index from a key is 400.
// All keys mint at the single metered tier.
app.post("/", requireAuth(), async (c) => {
	const body = await c.req.json().catch(() => ({}));
	const parsed = CreateKeySchema.parse(body);
	// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
	const ctx = c as any;
	const accountId = ctx.get("accountId");
	const caller = {
		isSession: Boolean(ctx.get("session")),
		apiKeyProduct: ctx.get("apiKey")?.product ?? null,
	};
	assertCanMint(caller);
	if (!caller.isSession && parsed.product !== "account") {
		throw new ValidationError(
			"API-key callers mint account keys only; omit product or pass account.",
		);
	}

	const minted = await mintApiKey(getDb(), {
		accountId,
		name: parsed.name,
		product: resolveMintProduct(caller, parsed.product),
		ip: getClientIp(c),
	});

	return c.json(minted, 201);
});

// List keys (requires auth, scoped to account)
app.get("/", requireAuth(), async (c) => {
	// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
	const accountId = (c as any).get("accountId");
	const db = getDb();

	const keys = await db
		.selectFrom("api_keys")
		.select([
			"id",
			"key_prefix",
			"name",
			"status",
			"product",
			"tier",
			"created_at",
			"last_used_at",
		])
		.where("account_id", "=", accountId)
		.orderBy("created_at", "desc")
		.execute();

	return c.json({
		keys: keys.map((k: (typeof keys)[number]) => ({
			id: k.id,
			prefix: k.key_prefix,
			name: k.name,
			status: k.status,
			product: k.product,
			tier: k.tier,
			createdAt: k.created_at.toISOString(),
			lastUsedAt: k.last_used_at?.toISOString() ?? null,
		})),
	});
});

// Revoke key (requires auth, same account)
app.delete("/:id", requireAuth(), async (c) => {
	const { id } = c.req.param();
	// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
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
		return c.json(
			{ error: "Cannot revoke keys from a different account" },
			403,
		);
	}

	await db
		.updateTable("api_keys")
		.set({ status: "revoked", revoked_at: new Date() })
		.where("id", "=", id)
		.execute();

	return c.json({ revoked: true, id });
});

export default app;
