import { type Kysely, sql } from "kysely";
import { onChainPlane } from "../src/db/migration-role.ts";

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onChainPlane(async () => {
		await sql`
			CREATE TABLE IF NOT EXISTS observer_journal_cold_ranges (
				network TEXT NOT NULL,
				kind TEXT NOT NULL CHECK (kind IN ('new_block', 'new_burn_block')),
				from_height BIGINT NOT NULL,
				to_height BIGINT NOT NULL,
				rows BIGINT NOT NULL,
				min_sequence BIGINT NOT NULL,
				max_sequence BIGINT NOT NULL,
				object_key TEXT NOT NULL,
				file_sha256 TEXT NOT NULL,
				manifest_key TEXT NOT NULL,
				verified_at TIMESTAMPTZ,
				PRIMARY KEY (network, kind, from_height)
			)
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`DROP TABLE IF EXISTS observer_journal_cold_ranges`.execute(db);
	});
}
