/**
 * `POST /internal/keys/tenant` — mints the dedicated `hosted-stack` account
 * key a tenant's own `webhook-service` uses to read hosted Index/Streams
 * (D6, plan 044). Review fix: the customer's PRESENTED key must never reach
 * a tenant stack ("The customer's key never reaches the stack" — Design).
 * The provisioner calls this route itself, during `up()`, instead of
 * forwarding whatever key the customer happened to present on the request
 * that triggered provisioning.
 *
 * Idempotent/rotating: revokes any previous `hosted-stack` key for the
 * account first, then mints a fresh one — calling this twice for the same
 * account never leaves two `hosted-stack` keys active.
 *
 * Guard is the same `workloadHostKeyMatches()` + `bearerToken()` pair
 * `/internal/meters` and `/internal/keys/introspect` use.
 */

import { getDb } from "@secondlayer/shared/db";
import {
	AuthenticationError,
	ValidationError,
} from "@secondlayer/shared/errors";
import { Hono } from "hono";
import { mintApiKey, revokeKeysByName } from "../auth/mint.ts";
import { InvalidJSONError } from "../middleware/error.ts";
import { bearerToken, workloadHostKeyMatches } from "./internal-meters.ts";

export const HOSTED_STACK_KEY_NAME = "hosted-stack";

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
	const accountId =
		typeof body === "object" && body !== null
			? (body as Record<string, unknown>).account_id
			: undefined;
	if (typeof accountId !== "string" || accountId.length === 0) {
		throw new ValidationError("body must be { account_id: string }");
	}

	const db = getDb();
	await revokeKeysByName(db, accountId, HOSTED_STACK_KEY_NAME);
	const minted = await mintApiKey(db, {
		accountId,
		name: HOSTED_STACK_KEY_NAME,
		product: "account",
		ip: "workload-host",
		// The evaluator's reads are ours, not the customer's rows.
		internal: true,
	});

	return c.json({ key: minted.key });
});

export default app;
