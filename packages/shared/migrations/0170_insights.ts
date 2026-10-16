import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * Ranked dashboard insights (one open row per resource + rule) and the
 * per-resource "expected" mutes. Created on every control-plane database:
 * the platform DB (account rules) and each tenant / self-host DB (webhook and
 * subgraph rules). `account_id` is NULL on tenant and self-host rows (there is
 * no meaningful account id there) so it carries no foreign key.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`
			CREATE TABLE insights (
				id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
				account_id    uuid,
				resource_kind text NOT NULL,
				resource_id   text NOT NULL,
				rule          text NOT NULL,
				severity      text NOT NULL,
				impact        double precision NOT NULL DEFAULT 0,
				payload       jsonb NOT NULL,
				first_seen_at timestamptz NOT NULL DEFAULT now(),
				last_seen_at  timestamptz NOT NULL DEFAULT now(),
				clear_streak  integer NOT NULL DEFAULT 0,
				resolved_at   timestamptz,
				dismissed_at  timestamptz
			)
		`.execute(db);

		await sql`
			CREATE UNIQUE INDEX insights_open_key ON insights
				(coalesce(account_id, '00000000-0000-0000-0000-000000000000'::uuid), resource_kind, resource_id, rule)
				WHERE resolved_at IS NULL
		`.execute(db);

		await sql`
			CREATE INDEX insights_account_recent ON insights (account_id, resolved_at)
		`.execute(db);

		await sql`
			CREATE TABLE insight_mutes (
				account_id    uuid,
				resource_kind text NOT NULL,
				resource_id   text NOT NULL,
				rule          text NOT NULL,
				created_at    timestamptz NOT NULL DEFAULT now()
			)
		`.execute(db);

		await sql`
			CREATE UNIQUE INDEX insight_mutes_key ON insight_mutes
				(coalesce(account_id, '00000000-0000-0000-0000-000000000000'::uuid), resource_kind, resource_id, rule)
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`DROP TABLE IF EXISTS insight_mutes`.execute(db);
		await sql`DROP TABLE IF EXISTS insights`.execute(db);
	});
}
