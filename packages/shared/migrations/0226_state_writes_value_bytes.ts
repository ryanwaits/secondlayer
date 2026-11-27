import { type Kysely, sql } from "kysely";
import { LIVE_REWRITE_SPECS, swapLiveRewrite } from "../src/db/live-rewrite.ts";
import { onChainPlane } from "../src/db/migration-role.ts";

const INLINE_ROW_LIMIT = 1_000_000;

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onChainPlane(async () => {
		const hasValueHex = await sql<{ ok: boolean }>`
			SELECT EXISTS (
				SELECT 1 FROM information_schema.columns
				 WHERE table_schema = 'public' AND table_name = 'state_writes'
				   AND column_name = 'value_hex'
			) AS ok
		`.execute(db);
		if (hasValueHex.rows[0]?.ok !== true) return;

		const nextExists = await sql<{ ok: boolean }>`
			SELECT to_regclass('public.state_writes_next') IS NOT NULL AS ok
		`.execute(db);
		if (nextExists.rows[0]?.ok === true) {
			const spec = LIVE_REWRITE_SPECS.state_writes;
			if (!spec) throw new Error("state_writes live rewrite spec is missing");
			await swapLiveRewrite(db, spec);
			return;
		}

		const estimate = await sql<{ rows: string }>`
			SELECT reltuples::bigint::text AS rows FROM pg_class
			 WHERE oid = to_regclass('public.state_writes')
		`.execute(db);
		if (Number(estimate.rows[0]?.rows ?? 0) > INLINE_ROW_LIMIT) {
			throw new Error(
				"state_writes is too large for an inline rewrite: run the live rewrite tool (packages/indexer/src/live-rewrite.ts --table state_writes prepare, copy, catchup, index, verify, preflight), then migrate",
			);
		}

		await sql`
			DO $$
			BEGIN
				IF EXISTS (
					SELECT 1 FROM state_writes WHERE value_hex !~ '^([0-9a-f]{2})*$'
				) THEN
					RAISE EXCEPTION 'state_writes.value_hex holds non-canonical hex';
				END IF;
			END $$
		`.execute(db);
		await sql`ALTER TABLE state_writes ADD COLUMN value BYTEA`.execute(db);
		await sql`UPDATE state_writes SET value = decode(value_hex, 'hex')`.execute(
			db,
		);
		await sql`ALTER TABLE state_writes ALTER COLUMN value SET NOT NULL`.execute(
			db,
		);
		await sql`ALTER TABLE state_writes DROP COLUMN value_hex`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`ALTER TABLE state_writes ADD COLUMN IF NOT EXISTS value_hex TEXT`.execute(
			db,
		);
		await sql`UPDATE state_writes SET value_hex = encode(value, 'hex') WHERE value_hex IS NULL`.execute(
			db,
		);
		await sql`ALTER TABLE state_writes ALTER COLUMN value_hex SET NOT NULL`.execute(
			db,
		);
		await sql`ALTER TABLE state_writes DROP COLUMN IF EXISTS value`.execute(db);
	});
}
