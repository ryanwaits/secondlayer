/**
 * `POST /internal/keys/introspect` — resolves a presented `sk-sl_*` account
 * key to `{account_id, credits_ok}` for 044's gateway on the workload host:
 * it introspects the customer's key here (cached 60s/10s negative) before
 * ever forwarding a request into that account's tenant stack. The customer
 * key never reaches the stack (the gateway swaps in the stack's own
 * `INSTANCE_TOKEN` after this call).
 *
 * Guard is the same `workloadHostKeyMatches()` + `bearerToken()` pair
 * `/internal/meters` uses (`./internal-meters.ts`) — reused, not copied, so
 * the workload host authenticates against this API with one key and one
 * compare.
 *
 * Key lookup mirrors `requireAuth()`'s `sk-sl_*` branch
 * (`../auth/middleware.ts`): same hash, same `api_keys` table, same
 * revoked/ghost checks — introspection can never say a key is good when
 * `/api/*` would refuse it.
 */

import { getCredits } from "@secondlayer/platform/db/queries/account-credits";
import { getDb } from "@secondlayer/shared/db";
import {
	AuthenticationError,
	ValidationError,
} from "@secondlayer/shared/errors";
import { Hono } from "hono";
import { hashToken } from "../auth/keys.ts";
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
	if (typeof presented !== "string" || !presented.startsWith("sk-sl_")) {
		throw new ValidationError('body must be { key: "sk-sl_..." }');
	}

	const db = getDb();
	const keyRecord = await db
		.selectFrom("api_keys")
		.select(["account_id", "status"])
		.where("key_hash", "=", hashToken(presented))
		.executeTakeFirst();

	if (!keyRecord || keyRecord.status !== "active") {
		return c.json({ error: "invalid_key" }, 401);
	}

	// D4 (plan 044): no anonymous path — an unclaimed ghost account never
	// gets a tenant stack, same as the ghost write-guard in requireAuth().
	const owner = await db
		.selectFrom("accounts")
		.select("ghost")
		.where("id", "=", keyRecord.account_id)
		.executeTakeFirst();
	if (owner?.ghost) {
		return c.json({ error: "invalid_key" }, 401);
	}

	const balance = await getCredits(db, keyRecord.account_id);
	return c.json({
		account_id: keyRecord.account_id,
		credits_ok: balance > 0n,
	});
});

export default app;
