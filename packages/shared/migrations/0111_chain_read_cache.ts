import { type Kysely, sql } from "kysely";
import { onChainPlane } from "../src/db/migration-role.ts";

export async function up(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`SET lock_timeout = '30s'`.execute(db);

		// Memoizes `ctx.client.readOnly()` — block-pinned read-only contract calls
		// made from subgraph handlers. A handler that needs a token's decimals or a
		// pool's reserves otherwise pays a node RPC per event; a spike measured an
		// RPC at ~10x the cost of the two unbatched findOnes it would replace, so
		// the cache is what makes the call affordable at all, not an optimization.
		//
		// Keyed on `index_block_hash`, NOT block height: a read is pinned to the
		// exact block it was evaluated against, and a reorg replaces the block with
		// a different index_block_hash. Height-keyed entries would serve the
		// orphaned fork's answer to the replacement block — so reorg correctness is
		// a property of the key here, with no rollback path to get wrong.
		//
		// `block_height IS NULL` marks a contract-constant entry: the caller
		// declared the value cannot change (SIP-010 decimals/symbol), so it is
		// resolved once per contract+args instead of once per block. Nullable
		// `index_block_hash` participates in the primary key, hence the two partial
		// unique indexes rather than a composite PK.
		await sql`
		CREATE TABLE IF NOT EXISTS chain_read_cache (
			id BIGSERIAL PRIMARY KEY,
			contract_id TEXT NOT NULL,
			function_name TEXT NOT NULL,
			args_hash TEXT NOT NULL,
			index_block_hash TEXT,
			block_height BIGINT,
			result_hex TEXT NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`.execute(db);

		await sql`
		CREATE UNIQUE INDEX IF NOT EXISTS chain_read_cache_pinned_key
			ON chain_read_cache (contract_id, function_name, args_hash, index_block_hash)
			WHERE index_block_hash IS NOT NULL
	`.execute(db);

		await sql`
		CREATE UNIQUE INDEX IF NOT EXISTS chain_read_cache_constant_key
			ON chain_read_cache (contract_id, function_name, args_hash)
			WHERE index_block_hash IS NULL
	`.execute(db);

		// Pruning handle: drop everything below a height once a reindex window is
		// past, without scanning by key.
		await sql`
		CREATE INDEX IF NOT EXISTS chain_read_cache_block_height
			ON chain_read_cache (block_height)
			WHERE block_height IS NOT NULL
	`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`DROP TABLE IF EXISTS chain_read_cache`.execute(db);
	});
}
