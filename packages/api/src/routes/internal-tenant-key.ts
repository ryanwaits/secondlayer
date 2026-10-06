/**
 * `POST /internal/keys/tenant`: mints a dedicated account key for a tenant
 * stack. The customer's PRESENTED key must never reach a tenant stack ("The
 * customer's key never reaches the stack", Design); the provisioner calls
 * this route itself, during `up()`, instead of forwarding whatever key the
 * customer happened to present on the request that triggered provisioning.
 *
 * Two fixed names, two trust levels:
 * - `hosted-stack` (default): INTERNAL, unmetered. Only `webhook-service`
 *   gets it: it imports no customer code and its reads are ours.
 * - `hosted-subgraphs`: a normal METERED account key. Anything that runs
 *   customer code (`api`, `subgraph-processor`) gets this one, so indexing
 *   reads bill `rows.delivered` against the account's allowance and spend cap.
 *
 * Idempotent/rotating per name: revokes any previous key of that name for the
 * account first, then mints a fresh one, so calling this twice never leaves
 * two keys of the same name active.
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
export const HOSTED_SUBGRAPHS_KEY_NAME = "hosted-subgraphs";

const TENANT_KEY_NAMES = [HOSTED_STACK_KEY_NAME, HOSTED_SUBGRAPHS_KEY_NAME];

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
	const fields =
		typeof body === "object" && body !== null
			? (body as Record<string, unknown>)
			: {};
	const accountId = fields.account_id;
	if (typeof accountId !== "string" || accountId.length === 0) {
		throw new ValidationError(
			`body must be { account_id: string, name?: ${TENANT_KEY_NAMES.map((n) => `"${n}"`).join(" | ")} }`,
		);
	}
	const name = fields.name ?? HOSTED_STACK_KEY_NAME;
	if (typeof name !== "string" || !TENANT_KEY_NAMES.includes(name)) {
		throw new ValidationError(
			`name must be one of: ${TENANT_KEY_NAMES.join(", ")}`,
		);
	}

	const db = getDb();
	await revokeKeysByName(db, accountId, name);
	const minted = await mintApiKey(db, {
		accountId,
		name,
		product: "account",
		ip: "workload-host",
		// The evaluator's reads are ours, not the customer's rows; customer
		// code's reads are the customer's, so that key is metered.
		internal: name === HOSTED_STACK_KEY_NAME,
	});

	return c.json({ key: minted.key });
});

export default app;
