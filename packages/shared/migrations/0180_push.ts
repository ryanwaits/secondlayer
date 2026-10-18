import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * Web push for the installed phone app.
 *
 * `push_subscriptions`: one row per browser/device subscription. `endpoint` is
 * unique, so the same browser re-subscribing (or signing in as another
 * account) moves its row instead of duplicating it. `failed_count` counts
 * delivery errors since the last success; 404/410 responses delete the row.
 *
 * `push_prefs`: one row per account, written on first change. A missing row
 * means the column defaults, so most accounts never have one.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`
			CREATE TABLE push_subscriptions (
				id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
				account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
				endpoint        text NOT NULL UNIQUE,
				p256dh          text NOT NULL,
				auth            text NOT NULL,
				user_agent      text,
				created_at      timestamptz NOT NULL DEFAULT now(),
				last_success_at timestamptz,
				failed_count    integer NOT NULL DEFAULT 0
			)
		`.execute(db);
		await sql`
			CREATE INDEX push_subscriptions_account
				ON push_subscriptions (account_id)
		`.execute(db);
		await sql`
			CREATE TABLE push_prefs (
				account_id           uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
				webhook_failing      boolean NOT NULL DEFAULT true,
				subgraph_stopped     boolean NOT NULL DEFAULT true,
				subgraph_not_serving boolean NOT NULL DEFAULT true,
				replay_done          boolean NOT NULL DEFAULT true,
				spend_cap            boolean NOT NULL DEFAULT false,
				key_repeat           boolean NOT NULL DEFAULT false,
				updated_at           timestamptz NOT NULL DEFAULT now()
			)
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`DROP TABLE IF EXISTS push_prefs`.execute(db);
		await sql`DROP TABLE IF EXISTS push_subscriptions`.execute(db);
	});
}
