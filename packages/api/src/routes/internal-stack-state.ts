/**
 * `POST /internal/stack-state`: the workload host reports the real state of
 * hosted stacks (`tenants.state` + `stop_reason` in its control DB). The
 * platform keeps the latest per account in `hosted_stack_state`; a report
 * older than the stored one is ignored, so a late retry never rewinds it.
 *
 * Body `{ states: [{ account_id, state, stop_reason, observed_at }] }` ->
 * `{ applied }`. `stop_reason` is set exactly when `state` is `stopped`.
 *
 * Guard is the same `workloadHostKeyMatches()` + `bearerToken()` pair every
 * other first-party workload-host route uses.
 */

import {
	HOSTED_STACK_STATES,
	HOSTED_STACK_STOP_REASONS,
	upsertStackStates,
} from "@secondlayer/platform/db/queries/hosted-stack-state";
import { getDb } from "@secondlayer/shared/db";
import { AuthenticationError } from "@secondlayer/shared/errors";
import { Hono } from "hono";
import { z } from "zod";
import { InvalidJSONError } from "../middleware/error.ts";
import { bearerToken, workloadHostKeyMatches } from "./internal-meters.ts";

export const MAX_STACK_STATES_BATCH = 500;
/** Clock-skew tolerance between the workload host and this server. */
const OBSERVED_AT_TOLERANCE_MS = 5 * 60 * 1000;

const bodySchema = z.object({
	states: z
		.array(
			z
				.object({
					account_id: z.string().uuid(),
					state: z.enum(HOSTED_STACK_STATES),
					stop_reason: z.enum(HOSTED_STACK_STOP_REASONS).nullable(),
					observed_at: z.string().datetime(),
				})
				.refine((s) => (s.state === "stopped") === (s.stop_reason !== null), {
					message: "stop_reason is required when stopped, and only then",
				}),
		)
		.max(MAX_STACK_STATES_BATCH),
});

const app = new Hono();

app.post("/", async (c) => {
	const hostKey = bearerToken(c.req.header("authorization"));
	if (!hostKey || !workloadHostKeyMatches(hostKey)) {
		throw new AuthenticationError("Missing or invalid Authorization header", {
			hint: "Send the workload host key as `Authorization: Bearer $WORKLOAD_HOST_KEY`.",
			env_var: "WORKLOAD_HOST_KEY",
		});
	}

	const json = await c.req.json().catch(() => {
		throw new InvalidJSONError();
	});
	const body = bodySchema.parse(json);

	const latestAllowed = Date.now() + OBSERVED_AT_TOLERANCE_MS;
	const reports = body.states.map((s) => ({
		accountId: s.account_id,
		state: s.state,
		stopReason: s.stop_reason,
		observedAt: new Date(s.observed_at),
	}));
	if (reports.some((r) => r.observedAt.getTime() > latestAllowed)) {
		return c.json({ error: "observed_at must not be in the future" }, 400);
	}

	const applied = await upsertStackStates(getDb(), reports);
	return c.json({ applied });
});

export default app;
