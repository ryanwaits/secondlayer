import { type Kysely, type RawBuilder, sql } from "kysely";
import { onChainPlane } from "../src/db/migration-role.ts";

// Block ingest now evicts a pending tx once a confirmed tx from its sender
// spends its nonce. Rows already in `mempool_transactions` predate that and
// most can never confirm (prod: 173 of 207), so clear them once: a pending tx
// whose origin nonce is at or below a nonce its sender confirmed is dead.
//
// The node admitted each pending tx with a live nonce, so the tx that spent it
// landed after the oldest receipt: only blocks since then are scanned (an hour
// of slack, within the last 100k heights), never a sender's whole history.
// Skipped when a table is absent.
async function tableExists(db: Kysely<unknown>, table: string) {
	const { rows } = await sql<{ exists: boolean }>`
		SELECT to_regclass(${table}) IS NOT NULL AS exists
	`.execute(db);
	return rows[0]?.exists === true;
}

// SIP-005: the origin nonce is the 8 bytes after version(1) chain_id(4)
// auth_type(1) hash_mode(1) signer(20), for standard (0x04) and sponsored
// (0x05) auth alike. Same layout `rawTxNonce` reads.
function hexOf(column: RawBuilder<unknown>) {
	return sql`regexp_replace(${column}, '^0x', '')`;
}
function hasNonce(column: RawBuilder<unknown>) {
	return sql`(substr(${hexOf(column)}, 11, 2) IN ('04', '05')
		AND substr(${hexOf(column)}, 55, 16) ~ '^[0-9a-fA-F]{16}$')`;
}
function nonceOf(column: RawBuilder<unknown>) {
	return sql`('x' || substr(${hexOf(column)}, 55, 16))::bit(64)::bigint`;
}

export async function up(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		for (const table of ["mempool_transactions", "transactions", "blocks"]) {
			if (!(await tableExists(db, table))) return;
		}
		const { rows } = await sql<{ floor: string | number | null }>`
			SELECT min(height) AS floor
			  FROM blocks
			 WHERE height > (SELECT max(height) - 100000 FROM blocks)
			   AND timestamp >= (
			       SELECT extract(epoch FROM min(received_at) - interval '1 hour')
			         FROM mempool_transactions)
		`.execute(db);
		if (rows[0]?.floor == null) return;
		const floor = Number(rows[0].floor);
		const pending = sql.ref("m.raw_tx");
		const confirmed = sql.ref("t.raw_tx");
		await sql`
			DELETE FROM mempool_transactions m
			 USING (
			   SELECT t.sender, max(${nonceOf(confirmed)}) AS spent
			     FROM transactions t
			     JOIN blocks b ON b.height = t.block_height AND b.canonical
			    WHERE t.block_height >= ${floor}
			      AND t.sender IN (SELECT sender FROM mempool_transactions)
			      AND ${hasNonce(confirmed)}
			    GROUP BY t.sender
			 ) c
			 WHERE m.sender = c.sender
			   AND ${hasNonce(pending)}
			   AND ${nonceOf(pending)} <= c.spent
		`.execute(db);
	});
}

export async function down(): Promise<void> {
	// Data cleanup: the evicted txs could never confirm, nothing to restore.
}
