import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * Webhooks fire on chain events only. Delete subgraph-row webhooks (their
 * outbox and delivery rows cascade) and drop the columns that described them:
 * `subgraph_name`, `table_name`, `filter`, `runtime` on `webhooks` and
 * `subgraph_name`, `table_name` on `webhook_outbox`. `kind` stays, narrowed to
 * `'chain'` by CHECK. Control plane only (tables are TARGET).
 *
 * `down` restores the columns, defaults and constraints. The deleted rows are
 * not restored.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		const { rows } = await sql<{ name: string }>`
			SELECT name FROM webhooks WHERE kind = 'subgraph' ORDER BY name
		`.execute(db);
		if (rows.length > 0) {
			console.warn(
				`[0159] Deleted ${rows.length} subgraph webhook(s): ${rows.map((r) => r.name).join(", ")}. Subgraph webhooks were removed; react to rows from your Postgres or the subgraph API: https://www.secondlayer.tools/docs/subgraphs/reading#react-to-your-rows`,
			);
		}
		// FK ON DELETE CASCADE removes their outbox (0057) and delivery rows (0140).
		await sql`DELETE FROM webhooks WHERE kind = 'subgraph'`.execute(db);
		await sql`DELETE FROM webhook_outbox WHERE kind = 'subgraph'`.execute(db);
		await sql`DROP INDEX webhooks_matcher_idx`.execute(db);
		await sql`ALTER TABLE webhooks DROP CONSTRAINT webhooks_kind_shape`.execute(
			db,
		);
		await sql`ALTER TABLE webhooks DROP COLUMN subgraph_name, DROP COLUMN table_name, DROP COLUMN filter, DROP COLUMN runtime`.execute(
			db,
		);
		await sql`ALTER TABLE webhooks ALTER COLUMN kind SET DEFAULT 'chain', ALTER COLUMN triggers SET NOT NULL`.execute(
			db,
		);
		await sql`ALTER TABLE webhooks ADD CONSTRAINT webhooks_kind_shape CHECK (kind = 'chain')`.execute(
			db,
		);
		await sql`ALTER TABLE webhook_outbox DROP COLUMN subgraph_name, DROP COLUMN table_name`.execute(
			db,
		);
		await sql`ALTER TABLE webhook_outbox ALTER COLUMN kind SET DEFAULT 'chain'`.execute(
			db,
		);
		await sql`ALTER TABLE webhook_outbox ADD CONSTRAINT webhook_outbox_kind_chain CHECK (kind = 'chain')`.execute(
			db,
		);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		await sql`ALTER TABLE webhook_outbox DROP CONSTRAINT webhook_outbox_kind_chain`.execute(
			db,
		);
		await sql`ALTER TABLE webhook_outbox ALTER COLUMN kind SET DEFAULT 'subgraph'`.execute(
			db,
		);
		await sql`ALTER TABLE webhook_outbox ADD COLUMN subgraph_name TEXT, ADD COLUMN table_name TEXT`.execute(
			db,
		);
		await sql`ALTER TABLE webhooks DROP CONSTRAINT webhooks_kind_shape`.execute(
			db,
		);
		await sql`ALTER TABLE webhooks ALTER COLUMN triggers DROP NOT NULL, ALTER COLUMN kind SET DEFAULT 'subgraph'`.execute(
			db,
		);
		await sql`
			ALTER TABLE webhooks
				ADD COLUMN subgraph_name TEXT,
				ADD COLUMN table_name TEXT,
				ADD COLUMN filter JSONB NOT NULL DEFAULT '{}'::jsonb,
				ADD COLUMN runtime TEXT
		`.execute(db);
		await sql`
			ALTER TABLE webhooks ADD CONSTRAINT webhooks_kind_shape CHECK (
				(kind = 'subgraph' AND subgraph_name IS NOT NULL AND table_name IS NOT NULL AND triggers IS NULL)
				OR
				(kind = 'chain' AND triggers IS NOT NULL AND subgraph_name IS NULL AND table_name IS NULL)
			)
		`.execute(db);
		await sql`
			CREATE INDEX webhooks_matcher_idx
				ON webhooks (subgraph_name, table_name, status)
				WHERE status = 'active'
		`.execute(db);
	});
}
