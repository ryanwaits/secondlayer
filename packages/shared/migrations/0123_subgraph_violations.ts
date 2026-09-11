import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * Bounded log of print-validate skips (runner skip+log). Control plane only —
 * never in `subgraph_<name>` (that would appear on `/v1` tables).
 * Cap of 100 rows per subgraph is enforced at write time.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		await sql`
			CREATE TABLE IF NOT EXISTS subgraph_violations (
				id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
				subgraph_name   text NOT NULL,
				source_name     text NOT NULL,
				block_height    bigint NOT NULL,
				tx_id           text NOT NULL,
				reason          text NOT NULL,
				sample_payload  jsonb NOT NULL DEFAULT '{}'::jsonb,
				seen_at         timestamptz NOT NULL DEFAULT now()
			)
		`.execute(db);

		await sql`
			CREATE INDEX IF NOT EXISTS subgraph_violations_name_seen_idx
			ON subgraph_violations (subgraph_name, seen_at DESC)
		`.execute(db);

		await sql`
			CREATE INDEX IF NOT EXISTS subgraph_violations_name_height_idx
			ON subgraph_violations (subgraph_name, block_height)
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`DROP TABLE IF EXISTS subgraph_violations`.execute(db);
	});
}
