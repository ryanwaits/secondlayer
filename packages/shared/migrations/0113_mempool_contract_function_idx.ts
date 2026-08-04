import { type Kysely, sql } from "kysely";
import { onChainPlane } from "../src/db/migration-role.ts";

// `contract_id` has been a supported `?contract_id=` filter on the mempool
// read since 0086, but 0086 only indexed `sender` and `received_at` — every
// contract_id lookup has been a sequential scan. A composite index with
// `function_name` as the second column serves both: `contract_id` alone
// (leading-column match) for the existing filter, and `contract_id` +
// `function_name` together for watching one privileged function on a busy
// contract pre-confirmation.
export async function up(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`SET lock_timeout = '30s'`.execute(db);

		await sql`
			CREATE INDEX IF NOT EXISTS mempool_transactions_contract_function_idx
				ON mempool_transactions (contract_id, function_name)
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`DROP INDEX IF EXISTS mempool_transactions_contract_function_idx`.execute(
			db,
		);
	});
}
