import {
	type LargeOutflowInput,
	WORKFLOW_NAME_BY_KIND,
} from "@secondlayer/sentries";
import { logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import { parseJsonb } from "@secondlayer/shared/db/jsonb";
import {
	createSentry,
	deleteSentry,
	getSentryById,
	listAccountSentries,
	listSentryAlerts,
	updateSentry,
} from "@secondlayer/shared/db/queries/sentries";
import {
	CreateSentryRequestSchema,
	type SentryKind,
	UpdateSentryRequestSchema,
	getConfigSchemaForKind,
} from "@secondlayer/shared/schemas/sentries";
import { enqueueWorkflowRun } from "@secondlayer/workflow-runner";
import { type Context, Hono } from "hono";
import { getAccountId } from "../lib/ownership.ts";
import { InvalidJSONError } from "../middleware/error.ts";

const app = new Hono();

type AuthResult =
	| { ok: true; accountId: string }
	| { ok: false; response: Response };

function requireAccountId(c: Context): AuthResult {
	const accountId = getAccountId(c);
	if (!accountId) {
		return {
			ok: false,
			response: c.json({ error: "unauthenticated" }, 401),
		};
	}
	return { ok: true, accountId };
}

// ── List ────────────────────────────────────────────────────────────

app.get("/", async (c) => {
	const auth = requireAccountId(c);
	if (!auth.ok) return auth.response;

	const db = getDb();
	const rows = await listAccountSentries(db, auth.accountId);
	return c.json({
		data: rows.map((r) => ({
			...r,
			config: parseJsonb(r.config),
		})),
	});
});

// ── Detail (with alerts) ────────────────────────────────────────────

app.get("/:id", async (c) => {
	const auth = requireAccountId(c);
	if (!auth.ok) return auth.response;

	const id = c.req.param("id");
	const db = getDb();
	const sentry = await getSentryById(db, id, auth.accountId);
	if (!sentry) return c.json({ error: "not_found" }, 404);

	const alerts = await listSentryAlerts(db, id, 50);
	return c.json({
		sentry: { ...sentry, config: parseJsonb(sentry.config) },
		alerts: alerts.map((a) => ({ ...a, payload: parseJsonb(a.payload) })),
	});
});

// ── Create ──────────────────────────────────────────────────────────

app.post("/", async (c) => {
	const auth = requireAccountId(c);
	if (!auth.ok) return auth.response;

	const body = await c.req.json().catch(() => {
		throw new InvalidJSONError();
	});

	const parsed = CreateSentryRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: parsed.error.flatten().fieldErrors }, 400);
	}

	const { kind, name, config, delivery_webhook, active } = parsed.data;

	if (!WORKFLOW_NAME_BY_KIND[kind]) {
		return c.json({ error: { kind: [`unknown kind: ${kind}`] } }, 400);
	}

	const configSchema = getConfigSchemaForKind(kind as SentryKind);
	const configParse = configSchema.safeParse(config);
	if (!configParse.success) {
		return c.json(
			{ error: { config: configParse.error.flatten().fieldErrors } },
			400,
		);
	}

	const db = getDb();
	const row = await createSentry(db, {
		account_id: auth.accountId,
		kind,
		name,
		config: configParse.data as Record<string, unknown>,
		delivery_webhook,
		active,
	});

	logger.info("sentry.created", {
		sentryId: row.id,
		accountId: auth.accountId,
		kind,
	});

	return c.json({ sentry: { ...row, config: parseJsonb(row.config) } }, 201);
});

// ── Update ──────────────────────────────────────────────────────────

app.patch("/:id", async (c) => {
	const auth = requireAccountId(c);
	if (!auth.ok) return auth.response;

	const id = c.req.param("id");
	const body = await c.req.json().catch(() => {
		throw new InvalidJSONError();
	});

	const parsed = UpdateSentryRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: parsed.error.flatten().fieldErrors }, 400);
	}

	const db = getDb();
	const existing = await getSentryById(db, id, auth.accountId);
	if (!existing) return c.json({ error: "not_found" }, 404);

	if (parsed.data.config !== undefined) {
		const schema = getConfigSchemaForKind(existing.kind as SentryKind);
		const configParse = schema.safeParse(parsed.data.config);
		if (!configParse.success) {
			return c.json(
				{ error: { config: configParse.error.flatten().fieldErrors } },
				400,
			);
		}
		parsed.data.config = configParse.data as Record<string, unknown>;
	}

	const updated = await updateSentry(db, id, auth.accountId, parsed.data);
	if (!updated) return c.json({ error: "not_found" }, 404);

	return c.json({
		sentry: { ...updated, config: parseJsonb(updated.config) },
	});
});

// ── Delete ──────────────────────────────────────────────────────────

app.delete("/:id", async (c) => {
	const auth = requireAccountId(c);
	if (!auth.ok) return auth.response;

	const id = c.req.param("id");
	const db = getDb();
	const ok = await deleteSentry(db, id, auth.accountId);
	if (!ok) return c.json({ error: "not_found" }, 404);

	return c.json({ ok: true });
});

// ── Send test alert (enqueues a testMode workflow run) ──────────────

app.post("/:id/test", async (c) => {
	const auth = requireAccountId(c);
	if (!auth.ok) return auth.response;

	const id = c.req.param("id");
	const db = getDb();
	const sentry = await getSentryById(db, id, auth.accountId);
	if (!sentry) return c.json({ error: "not_found" }, 404);

	const workflowName = WORKFLOW_NAME_BY_KIND[sentry.kind];
	if (!workflowName) {
		return c.json({ error: `unknown kind: ${sentry.kind}` }, 400);
	}

	const config = parseJsonb<Record<string, unknown>>(sentry.config);
	const input: LargeOutflowInput = {
		sentryId: sentry.id,
		principal: String(config.principal ?? ""),
		thresholdMicroStx: String(config.thresholdMicroStx ?? "0"),
		deliveryWebhook: sentry.delivery_webhook,
		sinceIso: null,
		testMode: true,
	};

	try {
		const runId = await enqueueWorkflowRun(db, {
			workflowName,
			input,
		});
		logger.info("sentry.test.enqueued", { sentryId: id, runId });
		return c.json({ ok: true, runId });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.warn("sentry.test.failed", { sentryId: id, error: message });
		return c.json({ ok: false, error: message }, 500);
	}
});

export default app;
