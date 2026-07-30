import { type Kysely, sql } from "kysely";
import { onChainPlane } from "../src/db/migration-role.ts";

export async function up(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`SET lock_timeout = '30s'`.execute(db);

		// Blocks that arrived claiming a height we already hold, held until the
		// chain says which one won.
		//
		// The node's event observer emits competing blocks at the same height —
		// routine under Nakamoto — and a hash mismatch alone cannot tell a real
		// reorg from a sibling that is about to lose. Adopting on first sight is a
		// coin flip, and we lost it twice: 8,654,079 (2026-07-28) and 8,663,166
		// (2026-07-30), the second wedging every subgraph for seventeen hours.
		//
		// `blocks` is keyed by height, so a contender cannot sit beside the
		// incumbent there. The full observer payload is staged here instead, and
		// replayed through the normal ingest path if a later block names it as
		// parent. Rows live only while a fork is unresolved — usually one block.
		await sql`
			CREATE TABLE IF NOT EXISTS pending_fork_blocks (
				height BIGINT NOT NULL,
				block_hash TEXT NOT NULL,
				parent_hash TEXT NOT NULL,
				incumbent_hash TEXT NOT NULL,
				payload JSONB NOT NULL,
				received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				PRIMARY KEY (height, block_hash)
			)
		`.execute(db);

		// Resolution looks up a staged block by the parent_hash a later block
		// names — that lookup is the hot path.
		await sql`
			CREATE INDEX IF NOT EXISTS pending_fork_blocks_hash
				ON pending_fork_blocks (block_hash)
		`.execute(db);

		// Pruning handle for contenders that never won.
		await sql`
			CREATE INDEX IF NOT EXISTS pending_fork_blocks_height
				ON pending_fork_blocks (height)
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`DROP TABLE IF EXISTS pending_fork_blocks`.execute(db);
	});
}
