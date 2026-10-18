/**
 * Web push routes — the installed phone app's notification settings.
 * Session-authed upstream via `resourceAuth`. Not in the public OpenAPI.
 *
 *   GET    /api/push/prefs           VAPID public key + the six toggles
 *   PUT    /api/push/prefs           any subset of the toggles
 *   POST   /api/push/subscriptions   register this browser
 *   DELETE /api/push/subscriptions   forget this browser
 *
 * With no VAPID keys in the environment, `publicKey` is null and subscribing
 * answers 503: push is off, nothing else breaks.
 */

import {
	type PushKind,
	type PushPrefMap,
	deleteSubscription,
	getPushPrefs,
	saveSubscription,
	upsertPushPrefs,
} from "@secondlayer/platform/db/queries/push";
import { isPushServiceEndpoint } from "@secondlayer/platform/push/endpoint";
import { getDb } from "@secondlayer/shared/db";
import { Hono } from "hono";
import { z } from "zod";
import { getAccountId } from "../lib/ownership.ts";
import { InvalidJSONError } from "../middleware/error.ts";

const app = new Hono();

/** The API speaks camelCase; the columns are snake_case. */
const FIELDS = {
	webhookFailing: "webhook_failing",
	subgraphStopped: "subgraph_stopped",
	subgraphNotServing: "subgraph_not_serving",
	replayDone: "replay_done",
	spendCap: "spend_cap",
	keyRepeat: "key_repeat",
} as const satisfies Record<string, PushKind>;

function present(prefs: PushPrefMap) {
	return Object.fromEntries(
		Object.entries(FIELDS).map(([field, kind]) => [field, prefs[kind]]),
	);
}

const SubscribeSchema = z.object({
	endpoint: z
		.string()
		.max(1000)
		.url()
		.refine(isPushServiceEndpoint, "endpoint must be a browser push service"),
	keys: z.object({
		p256dh: z.string().min(1).max(200),
		auth: z.string().min(1).max(100),
	}),
	userAgent: z.string().max(300).optional(),
});

const UnsubscribeSchema = z.object({ endpoint: z.string().min(1).max(1000) });

app.get("/prefs", async (c) => {
	const accountId = getAccountId(c);
	if (!accountId) return c.json({ error: "Unauthorized" }, 401);

	return c.json({
		publicKey: process.env.VAPID_PUBLIC_KEY || null,
		prefs: present(await getPushPrefs(getDb(), accountId)),
	});
});

app.put("/prefs", async (c) => {
	const accountId = getAccountId(c);
	if (!accountId) return c.json({ error: "Unauthorized" }, 401);

	const body = (await c.req.json().catch(() => {
		throw new InvalidJSONError();
	})) as Record<string, unknown>;

	const patch: Partial<PushPrefMap> = {};
	for (const [field, kind] of Object.entries(FIELDS)) {
		const value = body[field];
		if (value === undefined) continue;
		if (typeof value !== "boolean") {
			return c.json({ error: `${field} must be a boolean` }, 400);
		}
		patch[kind] = value;
	}

	return c.json(present(await upsertPushPrefs(getDb(), accountId, patch)));
});

app.post("/subscriptions", async (c) => {
	const accountId = getAccountId(c);
	if (!accountId) return c.json({ error: "Unauthorized" }, 401);
	if (!process.env.VAPID_PUBLIC_KEY) {
		return c.json({ error: "Push isn't set up on this server." }, 503);
	}

	const body = await c.req.json().catch(() => {
		throw new InvalidJSONError();
	});
	const parsed = SubscribeSchema.safeParse(body);
	if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);

	await saveSubscription(getDb(), accountId, {
		endpoint: parsed.data.endpoint,
		p256dh: parsed.data.keys.p256dh,
		auth: parsed.data.keys.auth,
		userAgent: parsed.data.userAgent ?? null,
	});
	return c.json({ ok: true });
});

app.delete("/subscriptions", async (c) => {
	const accountId = getAccountId(c);
	if (!accountId) return c.json({ error: "Unauthorized" }, 401);

	const body = await c.req.json().catch(() => {
		throw new InvalidJSONError();
	});
	const parsed = UnsubscribeSchema.safeParse(body);
	if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);

	return c.json({
		removed: await deleteSubscription(getDb(), accountId, parsed.data.endpoint),
	});
});

export default app;
