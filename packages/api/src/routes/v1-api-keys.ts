import { getDb } from "@secondlayer/shared/db";
import { Hono } from "hono";
import { z } from "zod";
import { getClientIp } from "../auth/http.ts";
import { ipRateLimit } from "../auth/ip-rate-limit.ts";
import { requireAuth } from "../auth/middleware.ts";
import {
	assertCanMint,
	assertUnderKeyCeiling,
	mintApiKey,
} from "../auth/mint.ts";

// Agent-reachable key mint on the public product surface. A headless agent
// holding an account-level (owner) key can self-provision a SCOPED streams/index
// read key here — no dashboard required. The endpoint is owner-gated, never
// mints an account/superkey or pins a tier (inherits the account plan), is
// per-IP rate limited, and is bounded by the account's active-key ceiling.
//
// POST-from-a-browser is blocked by the GET-only public CORS, which is fine:
// this is a bearer-only, non-browser surface (CORS is browser-enforced).
const CreateScopedKeySchema = z.object({
	name: z.string().max(255).optional(),
	product: z.enum(["streams", "index"]).default("streams"),
});

const app = new Hono();

app.use("*", ipRateLimit(10));

app.post("/", requireAuth(), async (c) => {
	const body = await c.req.json().catch(() => ({}));
	const parsed = CreateScopedKeySchema.parse(body);
	// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
	const ctx = c as any;
	const accountId = ctx.get("accountId");
	assertCanMint({
		isSession: Boolean(ctx.get("session")),
		apiKeyProduct: ctx.get("apiKey")?.product ?? null,
	});

	const db = getDb();
	await assertUnderKeyCeiling(db, accountId);

	const minted = await mintApiKey(db, {
		accountId,
		name: parsed.name,
		product: parsed.product,
		tier: null,
		ip: getClientIp(c),
	});

	return c.json(minted, 201);
});

export default app;
