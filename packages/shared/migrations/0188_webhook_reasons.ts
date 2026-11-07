import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * Two reasons that used to be inferred from other columns become columns:
 *
 * - `webhooks.pause_reason` (`user` | `circuit`): was `circuit_opened_at IS NOT
 *   NULL` on a paused row. A paused webhook always has one; an active one never.
 *   The never-written `error` status goes away.
 * - `webhook_outbox.dead_reason` (`exhausted` | `orphaned`): was a prefix match
 *   on `last_error`. A dead row always has one; a live one never.
 *
 * Both are backfilled from the old signals before their CHECKs are added.
 * Tables are skipped when absent (not every database carries them). Constraints
 * must match `WebhookStatus`/`WebhookPauseReason` and `OutboxStatus`/`DeadReason`.
 */

const ORPHANED_PREFIX = "orphaned by reorg at ";

async function tableExists(db: Kysely<unknown>, table: string) {
	const { rows } = await sql<{ exists: boolean }>`
		SELECT to_regclass(${`public.${table}`}) IS NOT NULL AS exists
	`.execute(db);
	return rows[0]?.exists === true;
}

async function addCheck(
	db: Kysely<unknown>,
	table: string,
	name: string,
	expression: string,
) {
	await sql`ALTER TABLE ${sql.table(table)} DROP CONSTRAINT IF EXISTS ${sql.id(name)}`.execute(
		db,
	);
	await sql`
		ALTER TABLE ${sql.table(table)}
			ADD CONSTRAINT ${sql.id(name)} CHECK (${sql.raw(expression)}) NOT VALID
	`.execute(db);
	await sql`ALTER TABLE ${sql.table(table)} VALIDATE CONSTRAINT ${sql.id(name)}`.execute(
		db,
	);
}

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		if (await tableExists(db, "webhooks")) {
			await sql`ALTER TABLE webhooks ADD COLUMN IF NOT EXISTS pause_reason text`.execute(
				db,
			);
			await sql`UPDATE webhooks SET status = 'active' WHERE status NOT IN ('active', 'paused')`.execute(
				db,
			);
			await sql`
				UPDATE webhooks
				SET pause_reason = CASE WHEN circuit_opened_at IS NOT NULL THEN 'circuit' ELSE 'user' END
				WHERE status = 'paused' AND pause_reason IS NULL
			`.execute(db);
			await sql`UPDATE webhooks SET pause_reason = NULL WHERE status <> 'paused'`.execute(
				db,
			);
			await addCheck(
				db,
				"webhooks",
				"webhooks_status_check",
				"status IN ('active', 'paused')",
			);
			await addCheck(
				db,
				"webhooks",
				"webhooks_pause_reason_check",
				"(status = 'paused') = (pause_reason IS NOT NULL) AND (pause_reason IS NULL OR pause_reason IN ('user', 'circuit'))",
			);
		}

		if (await tableExists(db, "webhook_outbox")) {
			await sql`ALTER TABLE webhook_outbox ADD COLUMN IF NOT EXISTS dead_reason text`.execute(
				db,
			);
			await sql`
				UPDATE webhook_outbox
				SET dead_reason = CASE
					WHEN last_error LIKE ${`${ORPHANED_PREFIX}%`} THEN 'orphaned'
					ELSE 'exhausted'
				END
				WHERE status = 'dead' AND dead_reason IS NULL
			`.execute(db);
			await sql`UPDATE webhook_outbox SET dead_reason = NULL WHERE status <> 'dead'`.execute(
				db,
			);
			await addCheck(
				db,
				"webhook_outbox",
				"webhook_outbox_dead_reason_check",
				"(status = 'dead') = (dead_reason IS NOT NULL) AND (dead_reason IS NULL OR dead_reason IN ('exhausted', 'orphaned'))",
			);
		}
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		if (await tableExists(db, "webhooks")) {
			await sql`ALTER TABLE webhooks DROP CONSTRAINT IF EXISTS webhooks_pause_reason_check`.execute(
				db,
			);
			await sql`ALTER TABLE webhooks DROP CONSTRAINT IF EXISTS webhooks_status_check`.execute(
				db,
			);
			await sql`ALTER TABLE webhooks DROP COLUMN IF EXISTS pause_reason`.execute(
				db,
			);
		}
		if (await tableExists(db, "webhook_outbox")) {
			await sql`ALTER TABLE webhook_outbox DROP CONSTRAINT IF EXISTS webhook_outbox_dead_reason_check`.execute(
				db,
			);
			await sql`ALTER TABLE webhook_outbox DROP COLUMN IF EXISTS dead_reason`.execute(
				db,
			);
		}
	});
}
