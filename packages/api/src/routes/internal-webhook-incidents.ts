/**
 * `POST /internal/webhook-incidents` — the workload host reports, once a
 * minute per running tenant, which of the account's webhooks are down. This
 * route keeps the incident debounce table and sends one email per account
 * when an incident opens. Tenant stacks never call it: the workload host is
 * the only process that reads tenant webhooks and talks to the platform.
 *
 * Auth: `WORKLOAD_HOST_KEY` only (not the Sentinel key).
 */
import {
	MAX_EMAIL_ATTEMPTS,
	dueIncidents,
	markEmailed,
	recordAttempts,
	syncIncidents,
} from "@secondlayer/platform/db/queries/webhook-incident-alerts";
import { logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import { sendEmail } from "@secondlayer/shared/email";
import { AuthenticationError, NotFoundError } from "@secondlayer/shared/errors";
import { Hono } from "hono";
import { z } from "zod";
import { buildWebhookIncidentEmail } from "../lib/webhook-incident-email.ts";
import { InvalidJSONError } from "../middleware/error.ts";
import { bearerToken, workloadHostKeyMatches } from "./internal-meters.ts";

/** Clock-skew tolerance between the workload host and this server. */
const OBSERVED_AT_TOLERANCE_MS = 5 * 60 * 1000;

const bodySchema = z.object({
	accountId: z.string().uuid(),
	observedAt: z.string().datetime(),
	webhookIds: z.array(z.string().min(1).max(200)).max(500),
	down: z
		.array(
			z.object({
				id: z.string().min(1).max(200),
				name: z.string().min(1).max(200),
				host: z.string().min(1).max(300),
				failingSince: z.string().datetime(),
				failures: z.number().int().min(0),
				lastError: z.string().max(200).nullable(),
			}),
		)
		.max(200),
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
	const body = bodySchema.parse(json);

	const observedAt = new Date(body.observedAt);
	if (Math.abs(Date.now() - observedAt.getTime()) > OBSERVED_AT_TOLERANCE_MS) {
		return c.json({ error: "observedAt must be within 5 minutes of now" }, 400);
	}

	const db = getDb();
	const account = await db
		.selectFrom("accounts")
		.select(["id", "email"])
		.where("id", "=", body.accountId)
		.executeTakeFirst();
	if (!account) throw new NotFoundError("account not found");

	const down = body.down.map((d) => ({
		...d,
		failingSince: new Date(d.failingSince),
	}));
	const { opened, resolved } = await syncIncidents(
		db,
		account.id,
		{ webhookIds: body.webhookIds, down },
		observedAt,
	);

	// Everything open and not yet emailed goes out in one email: this tick's new
	// incidents plus earlier ones whose send failed. Resolved incidents are
	// never due, so a recovery never produces a late email.
	if (account.email) {
		const due = await dueIncidents(db, account.id);
		const byId = new Map(down.map((d) => [d.id, d]));
		const items = due.flatMap((row) => {
			const d = byId.get(row.webhook_id);
			return d ? [{ row, d }] : [];
		});
		if (items.length > 0) {
			const attempted = await recordAttempts(
				db,
				items.map((i) => i.row.id),
			);
			const email = buildWebhookIncidentEmail(
				items.map(({ d }) => ({
					id: d.id,
					name: d.name,
					host: d.host,
					failingSince: d.failingSince,
					failures: d.failures,
					lastError: d.lastError,
				})),
			);
			try {
				await sendEmail({ to: account.email, ...email });
				await markEmailed(
					db,
					items.map((i) => i.row.id),
					new Date(),
				);
				logger.info("webhook_incident.email_sent", {
					accountId: account.id,
					count: items.length,
				});
			} catch (err) {
				const gaveUp = attempted.some(
					(r) => r.email_attempts >= MAX_EMAIL_ATTEMPTS,
				);
				logger.warn(
					gaveUp
						? "webhook_incident.email_gave_up"
						: "webhook_incident.email_failed",
					{
						accountId: account.id,
						count: items.length,
						error: err instanceof Error ? err.message : String(err),
					},
				);
			}
		}
	}

	return c.json({ opened: opened.length, resolved });
});

export default app;
