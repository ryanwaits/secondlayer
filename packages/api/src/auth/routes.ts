import { rowsByKeyDaily } from "@secondlayer/platform/db/queries/usage-ledger";
import { getDb, sql } from "@secondlayer/shared/db";
import { AuthorizationError, RateLimitError } from "@secondlayer/shared/errors";
import { Hono } from "hono";
import { z } from "zod";
import { getClientIp } from "./http.ts";
import { requireAuth } from "./middleware.ts";
import {
	DOCS_KEY_DAILY_LIMIT,
	assertCanMint,
	assertUnderKeyCeiling,
	mintApiKey,
	mintDocsKey,
	resolveMintProduct,
} from "./mint.ts";
import { getRateLimitStore } from "./rate-limit-store.ts";

// No tier field: every key mints at the single metered tier (see mint.ts).
// A legacy `tier` in the body is silently stripped by zod.
// Account keys only — scoped streams/index products 400.
export const CreateKeySchema = z.object({
	name: z.string().max(255).optional(),
	product: z.enum(["account"]).default("account"),
});

const KEY_CREATE_LIMIT = 20;
const KEY_CREATE_WINDOW_MS = 60 * 60 * 1000;

const app = new Hono();

// Create key (requires auth — tied to account). Owner-gated: only a dashboard
// session or an account-product key may mint. All keys mint at the single
// metered tier as product `account`.
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

	const db = getDb();
	await assertUnderKeyCeiling(db, accountId);
	const limit = await getRateLimitStore().check(
		`key-create:${accountId}`,
		KEY_CREATE_LIMIT,
		KEY_CREATE_WINDOW_MS,
		{ failClosed: true },
	);
	if (!limit.allowed) {
		c.header("Retry-After", String(limit.retryAfter));
		throw new RateLimitError("Too many new keys. Try again later.");
	}

	const minted = await mintApiKey(db, {
		accountId,
		name: parsed.name,
		product: resolveMintProduct(caller, parsed.product),
		ip: getClientIp(c),
	});

	return c.json(minted, 201);
});

// Docs key: a read-only (Streams + Index), 24h key for code samples. Dashboard
// session only: an API key (any product) can never mint one, so a leaked key
// can't be turned into a fresh credential. The plaintext is in this response
// once and is never logged or stored (only the hash is).
app.post("/docs", requireAuth(), async (c) => {
	// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
	const ctx = c as any;
	c.header("Cache-Control", "no-store");
	if (!ctx.get("session")) {
		throw new AuthorizationError(
			"A docs key is minted from a signed-in session, not an API key.",
		);
	}
	const accountId = ctx.get("accountId") as string;
	const limit = await getRateLimitStore().check(
		`docs-key:${accountId}`,
		DOCS_KEY_DAILY_LIMIT,
		24 * 60 * 60 * 1000,
		{ failClosed: true },
	);
	if (!limit.allowed) {
		c.header("Retry-After", String(limit.retryAfter));
		throw new RateLimitError("Docs key limit reached for today");
	}
	const minted = await mintDocsKey(getDb(), {
		accountId,
		ip: getClientIp(c),
	});
	return c.json(
		{ key: minted.key, prefix: minted.prefix, expiresAt: minted.expiresAt },
		201,
	);
});

// List keys (requires auth, scoped to account)
app.get("/", requireAuth(), async (c) => {
	// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
	const accountId = (c as any).get("accountId");
	const db = getDb();

	const [keys, daily] = await Promise.all([
		db
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
				"expires_at",
			])
			.where("account_id", "=", accountId)
			// An expired docs key disappears from the list.
			.where((eb) =>
				eb.or([
					eb("expires_at", "is", null),
					eb("expires_at", ">", sql<Date>`now()`),
				]),
			)
			.orderBy("created_at", "desc")
			.execute(),
		rowsByKeyDaily(db, accountId),
	]);

	return c.json({
		keys: keys.map((k: (typeof keys)[number]) => {
			const rowsDaily = daily.get(k.id) ?? new Array<number>(30).fill(0);
			return {
				id: k.id,
				prefix: k.key_prefix,
				name: k.name,
				status: k.status,
				product: k.product,
				tier: k.tier,
				createdAt: k.created_at.toISOString(),
				lastUsedAt: k.last_used_at?.toISOString() ?? null,
				expiresAt: k.expires_at?.toISOString() ?? null,
				rowsDaily,
				rows30d: rowsDaily.reduce((sum, n) => sum + n, 0),
			};
		}),
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
