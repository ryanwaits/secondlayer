import { type Kysely, sql } from "kysely";
import { onChainPlane } from "../src/db/migration-role.ts";

// `sbtc_token_events` has no reader: its API went away with the datasets
// product surface. Every row duplicates a `decoded_events` ft_transfer /
// ft_mint / ft_burn row for the sBTC asset (the classic decoders write those
// for every contract), and the one extra column, `memo`, is the next print
// event, which `decoded_events` also holds. Chain-plane only; each step is
// skipped when its table is absent.
async function tableExists(db: Kysely<unknown>, table: string) {
	const { rows } = await sql<{ exists: boolean }>`
		SELECT to_regclass(${`public.${table}`}) IS NOT NULL AS exists
	`.execute(db);
	return rows[0]?.exists === true;
}

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onChainPlane(async () => {
		if (await tableExists(db, "sbtc_token_events")) {
			await sql`DROP TABLE IF EXISTS sbtc_token_events`.execute(db);
		}
		if (await tableExists(db, "decoder_checkpoints")) {
			await sql`DELETE FROM decoder_checkpoints WHERE decoder_name IN ('decode.sbtc_token.v1', 'backfill.sbtc_token')`.execute(
				db,
			);
		}
	});
}

// The rows can be rebuilt from `decoded_events` or Streams if ever needed.
export async function down(_db: Kysely<unknown>): Promise<void> {}
