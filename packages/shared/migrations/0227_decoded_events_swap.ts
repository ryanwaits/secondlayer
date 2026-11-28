import { type Kysely, sql } from "kysely";
import { LIVE_REWRITE_SPECS, swapLiveRewrite } from "../src/db/live-rewrite.ts";
import { onChainPlane } from "../src/db/migration-role.ts";

export const INLINE_REWRITE_MAX_ROWS = 1_000_000;

async function tableExists(db: Kysely<unknown>, table: string) {
	const { rows } = await sql<{ exists: boolean }>`
		SELECT to_regclass(${table}) IS NOT NULL AS exists
	`.execute(db);
	return rows[0]?.exists === true;
}

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onChainPlane(async () => {
		if (!(await tableExists(db, "decoded_events"))) return;

		if (await tableExists(db, "decoded_events_next")) {
			const spec = LIVE_REWRITE_SPECS.decoded_events;
			if (!spec) throw new Error("decoded_events live-rewrite spec missing");
			await swapLiveRewrite(db, spec);
			return;
		}

		const { rows } = await sql<{ rows: string }>`
			SELECT greatest(reltuples, 0)::bigint::text AS rows
			  FROM pg_class WHERE oid = 'decoded_events'::regclass
		`.execute(db);
		const estimate = Number(rows[0]?.rows ?? 0);
		if (estimate > INLINE_REWRITE_MAX_ROWS) {
			throw new Error(
				`decoded_events has ~${estimate} rows and no decoded_events_next: run packages/indexer/src/live-rewrite.ts --table decoded_events first`,
			);
		}

		await sql`
			UPDATE decoded_events
			   SET raw_value = decode(substr((payload #>> '{}')::jsonb ->> 'raw_value', 3), 'hex'),
			       payload = NULL
			 WHERE event_type = 'print' AND raw_value IS NULL
			   AND jsonb_typeof(payload) = 'string'
			   AND (payload #>> '{}')::jsonb ->> 'raw_value' ~ '^0x([0-9a-f]{2})+$'
		`.execute(db);
		await sql`
			UPDATE decoded_events SET payload = (payload #>> '{}')::jsonb
			 WHERE jsonb_typeof(payload) = 'string'
		`.execute(db);
	});
}

export async function down(_db: Kysely<unknown>): Promise<void> {}
