import { runTestAlert } from "@secondlayer/sentries";
import { UnknownSentryKindError, getKind } from "@secondlayer/sentries";
import { logger } from "@secondlayer/shared";
import { getDb, getSourceDb } from "@secondlayer/shared/db";
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
	UpdateSentryRequestSchema,
} from "@secondlayer/shared/schemas/sentries";
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

	// Per-kind config validation.
	let kindImpl: ReturnType<typeof getKind>;
	try {
		kindImpl = getKind(kind);
	} catch (err) {
		if (err instanceof UnknownSentryKindError) {
			return c.json({ error: { kind: [err.message] } }, 400);
		}
		throw err;
	}

	const configParse = kindImpl.configSchema.safeParse(config);
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

	// If config is being updated, revalidate against the kind's schema.
	if (parsed.data.config !== undefined) {
		const kindImpl = getKind(existing.kind);
		const configParse = kindImpl.configSchema.safeParse(parsed.data.config);
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

// ── Send test alert ─────────────────────────────────────────────────

app.post("/:id/test", async (c) => {
	const auth = requireAccountId(c);
	if (!auth.ok) return auth.response;

	const id = c.req.param("id");
	const db = getDb();
	const sentry = await getSentryById(db, id, auth.accountId);
	if (!sentry) return c.json({ error: "not_found" }, 404);

	const result = await runTestAlert(
		getSourceDb(),
		{
			id: sentry.id,
			kind: sentry.kind,
			config: parseJsonb(sentry.config),
			delivery_webhook: sentry.delivery_webhook,
		},
		{ logger },
	);

	if (!result.ok) {
		logger.warn("sentry.test.failed", {
			sentryId: id,
			error: result.error,
		});
		return c.json({ ok: false, error: result.error }, 502);
	}

	return c.json({ ok: true });
});

export default app;
