/**
 * `POST /internal/push`: the workload host reports facts about one account
 * that only it can see: a hosted subgraph that stopped, and replays that
 * finished on the tenant's stack. This route builds the copy and sends the
 * push, once per signal (see `pushOnce`). Tenant insights are never forwarded
 * or pushed: a body with an `insights` field is rejected.
 *
 * Auth: `WORKLOAD_HOST_KEY` only, exactly like `/internal/webhook-incidents`.
 */
import {
	replayDonePush,
	subgraphStoppedPush,
} from "@secondlayer/platform/push/copy";
import { purgePushSent, pushOnce } from "@secondlayer/platform/push/once";
import { getDb } from "@secondlayer/shared/db";
import { AuthenticationError, NotFoundError } from "@secondlayer/shared/errors";
import { Hono } from "hono";
import { z } from "zod";
import { InvalidJSONError } from "../middleware/error.ts";
import { bearerToken, workloadHostKeyMatches } from "./internal-meters.ts";

/** Clock-skew tolerance between the workload host and this server. */
const OBSERVED_AT_TOLERANCE_MS = 5 * 60 * 1000;
const PURGE_EVERY_MS = 60 * 60 * 1000;
let lastPurgeAt = 0;

const bodySchema = z.object({
	accountId: z.string().uuid(),
	observedAt: z.string().datetime(),
	replays: z
		.array(
			z.object({
				replayId: z.string().min(1).max(64),
				webhookId: z.string().min(1).max(200),
				webhookName: z.string().min(1).max(200),
				finishedAt: z.string().datetime(),
				delivered: z.number().int().min(0),
				gaveUp: z.number().int().min(0),
				total: z.number().int().min(0),
			}),
		)
		.max(50)
		.default([]),
	stopped: z
		.array(
			z.object({
				subgraph: z.string().min(1).max(200),
				reason: z.enum(["out_of_memory", "crashed", "stalled", "error"]),
				height: z.number().int().min(0),
				lastError: z.string().max(300).nullable(),
			}),
		)
		.max(50)
		.default([]),
});

const app = new Hono();

app.post("/", async (c) => {
	const raw = bearerToken(c.req.header("authorization"));
	if (raw === null || !workloadHostKeyMatches(raw)) {
		throw new AuthenticationError("Missing or invalid Authorization header", {
			hint: "Send the workload host key as `Authorization: Bearer $WORKLOAD_HOST_KEY`.",
			env_var: "WORKLOAD_HOST_KEY",
		});
	}

	const json = await c.req.json().catch(() => {
		throw new InvalidJSONError();
	});
	if (json && typeof json === "object" && "insights" in json) {
		return c.json({ error: "tenant insights are never pushed" }, 400);
	}
	const body = bodySchema.parse(json);

	const observedAt = new Date(body.observedAt);
	if (Math.abs(Date.now() - observedAt.getTime()) > OBSERVED_AT_TOLERANCE_MS) {
		return c.json({ error: "observedAt must be within 5 minutes of now" }, 400);
	}

	const db = getDb();
	const account = await db
		.selectFrom("accounts")
		.select("id")
		.where("id", "=", body.accountId)
		.executeTakeFirst();
	if (!account) throw new NotFoundError("account not found");

	const counts = { sent: 0, duplicate: 0, skipped: 0 };
	for (const e of body.stopped) {
		counts[
			await pushOnce(
				db,
				account.id,
				`subgraph_stopped:${e.subgraph}:${e.height}`,
				"subgraph_stopped",
				subgraphStoppedPush(e),
			)
		]++;
	}
	for (const r of body.replays) {
		counts[
			await pushOnce(
				db,
				account.id,
				`replay_done:${r.replayId}:${r.finishedAt}`,
				"replay_done",
				replayDonePush(r),
			)
		]++;
	}

	if (Date.now() - lastPurgeAt > PURGE_EVERY_MS) {
		lastPurgeAt = Date.now();
		await purgePushSent(db).catch(() => undefined);
	}

	return c.json(counts);
});

export default app;
