import { type Kysely, sql } from "kysely";
import { onChainPlane } from "../src/db/migration-role.ts";

// BNS-V2 `buy-in-ustx` prints only `{a, id}`, so buys had no price. A buy needs
// a `market` entry, which only `list-in-ustx` sets, so the price and commission
// are on the latest listing for that id before the buy; the decoder now copies
// them on write. Fill stored buys the same way (133 rows at writing; buys whose
// listing predates the table stay null). Skipped when the table is absent.
async function tableExists(db: Kysely<unknown>, table: string) {
	const { rows } = await sql<{ exists: boolean }>`
		SELECT to_regclass(${`public.${table}`}) IS NOT NULL AS exists
	`.execute(db);
	return rows[0]?.exists === true;
}

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onChainPlane(async () => {
		if (!(await tableExists(db, "bns_marketplace_events"))) return;
		await sql`
			UPDATE bns_marketplace_events b
			SET (price_ustx, commission) = (
				SELECT l.price_ustx, l.commission
				FROM bns_marketplace_events l
				WHERE l.bns_id = b.bns_id
					AND l.action = 'list-in-ustx'
					AND l.canonical
					AND (l.block_height, l.event_index) < (b.block_height, b.event_index)
				ORDER BY l.block_height DESC, l.event_index DESC
				LIMIT 1
			)
			WHERE b.action = 'buy-in-ustx'
				AND b.price_ustx IS NULL
		`.execute(db);
	});
}

// Data fill only: the decoder writes the same values, nothing to undo.
export async function down(): Promise<void> {}
