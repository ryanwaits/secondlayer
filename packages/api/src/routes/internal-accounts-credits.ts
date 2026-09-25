/**
 * `POST /internal/accounts/credits` — bulk balance check for the
 * provisioner's 5-minute zero-balance poll (Design's `running → stopped` /
 * `stopped → running` transitions, plan 044). Body `{account_ids: [...]}`
 * (cap `MAX_ACCOUNTS_CREDITS_BATCH`) → `{[accountId]: creditsOk}`.
 *
 * Guard is the same `workloadHostKeyMatches()` + `bearerToken()` pair every
 * other first-party workload-host route uses.
 */

import { getCredits } from "@secondlayer/platform/db/queries/account-credits";
import { getDb } from "@secondlayer/shared/db";
import {
	AuthenticationError,
	ValidationError,
} from "@secondlayer/shared/errors";
import { Hono } from "hono";
import { InvalidJSONError } from "../middleware/error.ts";
import { bearerToken, workloadHostKeyMatches } from "./internal-meters.ts";

export const MAX_ACCOUNTS_CREDITS_BATCH = 500;

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
	const accountIds =
		typeof body === "object" &&
		body !== null &&
		Array.isArray((body as { account_ids?: unknown }).account_ids)
			? (body as { account_ids: unknown[] }).account_ids
			: undefined;
	if (!accountIds) {
		throw new ValidationError("body must be { account_ids: string[] }");
	}
	if (accountIds.length === 0) {
		return c.json({});
	}
	if (accountIds.length > MAX_ACCOUNTS_CREDITS_BATCH) {
		return c.json(
			{
				error: `batch of ${accountIds.length} exceeds max ${MAX_ACCOUNTS_CREDITS_BATCH} account ids per call`,
			},
			413,
		);
	}
	for (const id of accountIds) {
		if (typeof id !== "string" || id.length === 0) {
			throw new ValidationError(
				"account_ids must be an array of non-empty strings",
			);
		}
	}

	const db = getDb();
	const ids = accountIds as string[];
	const results = await Promise.all(
		ids.map(async (id) => [id, (await getCredits(db, id)) > 0n] as const),
	);

	return c.json(Object.fromEntries(results));
});

export default app;
