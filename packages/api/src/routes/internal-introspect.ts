/**
 * `POST /internal/keys/introspect` — resolves a presented `sk-sl_*` account
 * key OR `ss-sl_*` dashboard session token to `{account_id, credits_ok}` for
 * the gateway on the workload host: it introspects the customer's
 * credential here (cached 60s positive / 10s negative) before ever
 * forwarding a request into that account's tenant stack. The credential
 * never reaches the stack (the gateway swaps in the stack's own
 * `INSTANCE_TOKEN` after this call).
 *
 * Because the gateway's cache is positive for 60s, a session revoked (e.g.
 * the user logs out) right after a successful introspect can keep working
 * against the gateway for up to that long. Same tradeoff the `sk-sl_*` path
 * already accepts for a revoked key; no invalidation hook exists for either.
 *
 * Guard is the same `workloadHostKeyMatches()` + `bearerToken()` pair
 * `/internal/meters` uses (`./internal-meters.ts`) — reused, not copied, so
 * the workload host authenticates against this API with one key and one
 * compare.
 *
 * Key lookup mirrors `requireAuth()`'s `sk-sl_*` branch
 * (`../auth/middleware.ts`): same hash, same `api_keys` table, same
 * revoked/ghost checks. Session lookup shares `lookupSession()`
 * (`../auth/session.ts`) with `requireAuth()`'s `ss-sl_*` branch: same hash,
 * same `sessions` table, same revoked/expired checks — introspection can
 * never say a credential is good when `/api/*` would refuse it.
 */

import { getCredits } from "@secondlayer/platform/db/queries/account-credits";
import { getDb } from "@secondlayer/shared/db";
import {
	AuthenticationError,
	ValidationError,
} from "@secondlayer/shared/errors";
import { Hono } from "hono";
import { hashToken } from "../auth/keys.ts";
import { lookupSession } from "../auth/session.ts";
import { InvalidJSONError } from "../middleware/error.ts";
import { bearerToken, workloadHostKeyMatches } from "./internal-meters.ts";

const app = new Hono();

app.post("/", async (c) => {
	const hostKey = bearerToken(c.req.header("authorization"));
	if (!hostKey || !workloadHostKeyMatches(hostKey)) {
		throw new AuthenticationError("Missing or invalid Authorization header", {
			hint: "Send the workload host key as `Authorization: Bearer $WORKLOAD_HOST_KEY`.",
			env_var: "WORKLOAD_HOST_KEY",
		});
	}

	const body = await c.req.json().catch(() => {
		throw new InvalidJSONError();
	});
	const presented =
		typeof body === "object" && body !== null
			? (body as Record<string, unknown>).key
			: undefined;
	if (
		typeof presented !== "string" ||
		!(presented.startsWith("sk-sl_") || presented.startsWith("ss-sl_"))
	) {
		throw new ValidationError(
			'body must be { key: "sk-sl_..." or "ss-sl_..." }',
		);
	}

	const db = getDb();
	let accountId: string;

	if (presented.startsWith("ss-sl_")) {
		const lookup = await lookupSession(db, hashToken(presented));
		if (lookup.status !== "ok") {
			return c.json({ error: "invalid_key" }, 401);
		}
		accountId = lookup.session.account_id;
	} else {
		const keyRecord = await db
			.selectFrom("api_keys")
			.select(["account_id", "status"])
			.where("key_hash", "=", hashToken(presented))
			.executeTakeFirst();

		if (!keyRecord || keyRecord.status !== "active") {
			return c.json({ error: "invalid_key" }, 401);
		}
		accountId = keyRecord.account_id;
	}

	// No anonymous path: an unclaimed ghost account never gets a tenant
	// stack, same as the ghost write-guard in requireAuth().
	const owner = await db
		.selectFrom("accounts")
		.select("ghost")
		.where("id", "=", accountId)
		.executeTakeFirst();
	if (owner?.ghost) {
		return c.json({ error: "invalid_key" }, 401);
	}

	const balance = await getCredits(db, accountId);
	return c.json({
		account_id: accountId,
		credits_ok: balance > 0n,
	});
});

export default app;
