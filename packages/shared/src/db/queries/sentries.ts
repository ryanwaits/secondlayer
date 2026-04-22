import type { Kysely } from "kysely";
import { jsonb } from "../jsonb.ts";
import type {
	Database,
	InsertSentry,
	InsertSentryAlert,
	Sentry,
	SentryAlert,
	UpdateSentry,
} from "../types.ts";

// ── Sentries ─────────────────────────────────────────────────────────

export async function listActiveSentries(
	db: Kysely<Database>,
	limit = 200,
): Promise<Sentry[]> {
	return await db
		.selectFrom("sentries")
		.selectAll()
		.where("active", "=", true)
		.orderBy("last_check_at", "asc")
		.limit(limit)
		.execute();
}

export async function listAccountSentries(
	db: Kysely<Database>,
	accountId: string,
): Promise<Sentry[]> {
	return await db
		.selectFrom("sentries")
		.selectAll()
		.where("account_id", "=", accountId)
		.orderBy("created_at", "desc")
		.execute();
}

export async function getSentryById(
	db: Kysely<Database>,
	id: string,
	accountId: string,
): Promise<Sentry | null> {
	const row = await db
		.selectFrom("sentries")
		.selectAll()
		.where("id", "=", id)
		.where("account_id", "=", accountId)
		.executeTakeFirst();
	return row ?? null;
}

/** Internal — worker loads by id without account scoping (tick loop already filtered). */
export async function getSentryByIdUnscoped(
	db: Kysely<Database>,
	id: string,
): Promise<Sentry | null> {
	const row = await db
		.selectFrom("sentries")
		.selectAll()
		.where("id", "=", id)
		.executeTakeFirst();
	return row ?? null;
}

export async function createSentry(
	db: Kysely<Database>,
	input: {
		account_id: string;
		kind: string;
		name: string;
		config: Record<string, unknown>;
		delivery_webhook: string;
		active?: boolean;
	},
): Promise<Sentry> {
	const row = await db
		.insertInto("sentries")
		.values({
			account_id: input.account_id,
			kind: input.kind,
			name: input.name,
			config: jsonb(input.config),
			delivery_webhook: input.delivery_webhook,
			active: input.active ?? true,
		} as InsertSentry)
		.returningAll()
		.executeTakeFirstOrThrow();
	return row;
}

export async function updateSentry(
	db: Kysely<Database>,
	id: string,
	accountId: string,
	patch: {
		name?: string;
		config?: Record<string, unknown>;
		active?: boolean;
		delivery_webhook?: string;
	},
): Promise<Sentry | null> {
	const values: UpdateSentry = { updated_at: new Date() };
	if (patch.name !== undefined) values.name = patch.name;
	if (patch.config !== undefined) values.config = jsonb(patch.config);
	if (patch.active !== undefined) values.active = patch.active;
	if (patch.delivery_webhook !== undefined)
		values.delivery_webhook = patch.delivery_webhook;

	const row = await db
		.updateTable("sentries")
		.set(values)
		.where("id", "=", id)
		.where("account_id", "=", accountId)
		.returningAll()
		.executeTakeFirst();
	return row ?? null;
}

export async function deleteSentry(
	db: Kysely<Database>,
	id: string,
	accountId: string,
): Promise<boolean> {
	const result = await db
		.deleteFrom("sentries")
		.where("id", "=", id)
		.where("account_id", "=", accountId)
		.executeTakeFirst();
	return (result.numDeletedRows ?? 0n) > 0n;
}

export async function touchLastCheck(
	db: Kysely<Database>,
	id: string,
	at: Date,
): Promise<void> {
	await db
		.updateTable("sentries")
		.set({ last_check_at: at, updated_at: new Date() })
		.where("id", "=", id)
		.execute();
}

// ── Alerts ───────────────────────────────────────────────────────────

export async function listSentryAlerts(
	db: Kysely<Database>,
	sentryId: string,
	limit = 50,
): Promise<SentryAlert[]> {
	return await db
		.selectFrom("sentry_alerts")
		.selectAll()
		.where("sentry_id", "=", sentryId)
		.orderBy("fired_at", "desc")
		.limit(limit)
		.execute();
}

/**
 * Inserts an alert. Returns the inserted row, or null if the
 * (sentry_id, idempotency_key) unique constraint dedupes.
 */
export async function insertAlert(
	db: Kysely<Database>,
	input: {
		sentry_id: string;
		idempotency_key: string;
		payload: Record<string, unknown>;
	},
): Promise<SentryAlert | null> {
	const row = await db
		.insertInto("sentry_alerts")
		.values({
			sentry_id: input.sentry_id,
			idempotency_key: input.idempotency_key,
			payload: jsonb(input.payload),
		} as InsertSentryAlert)
		.onConflict((oc) =>
			oc.columns(["sentry_id", "idempotency_key"]).doNothing(),
		)
		.returningAll()
		.executeTakeFirst();
	return row ?? null;
}

export async function updateAlertDelivery(
	db: Kysely<Database>,
	alertId: string,
	status: "delivered" | "failed",
	error?: string,
): Promise<void> {
	await db
		.updateTable("sentry_alerts")
		.set({
			delivery_status: status,
			delivery_error: error ?? null,
		})
		.where("id", "=", alertId)
		.execute();
}
