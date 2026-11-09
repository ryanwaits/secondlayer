import { type Kysely, sql } from "kysely";
import { onChainPlane } from "../src/db/migration-role.ts";

// The dedicated pox-4 decoder and `/v1/index/stacking` are gone: pox-4 is a
// retired contract (the chain runs pox-5), and its history stays readable
// through the generic layers (contract-calls, Streams). Drop the decoded table
// and the decoder's checkpoint row. Chain-plane only; each step is skipped
// when its table is absent.
async function tableExists(db: Kysely<unknown>, table: string) {
	const { rows } = await sql<{ exists: boolean }>`
		SELECT to_regclass(${`public.${table}`}) IS NOT NULL AS exists
	`.execute(db);
	return rows[0]?.exists === true;
}

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onChainPlane(async () => {
		if (await tableExists(db, "pox4_calls")) {
			await sql`DROP TABLE IF EXISTS pox4_calls`.execute(db);
		}
		if (await tableExists(db, "decoder_checkpoints")) {
			await sql`DELETE FROM decoder_checkpoints WHERE decoder_name = 'decode.pox4.v1'`.execute(
				db,
			);
		}
	});
}

// No-op: nothing reads pox4_calls any more. Its rows are rebuildable from
// Streams (`contract_id=SP000000000000000000002Q6VF78.pox-4`) if ever needed.
export async function down(_db: Kysely<unknown>): Promise<void> {}
