import { type Kysely, sql } from "kysely";
import { onChainPlane } from "../src/db/migration-role.ts";

// `chain_reorgs.old_index_block_hash` / `new_index_block_hash` held the Stacks
// block hash (`blocks.hash`), not the index block hash they promise: every row
// written before this migration did. Rewrite each side to the index hash of the
// block it names: from `blocks` when that block still holds the fork height,
// else from a staged `pending_fork_blocks` payload. A side neither holds goes
// null (unknown) rather than keep a hash of the wrong kind. A side that already
// names an index hash at its height (written by the fixed indexer) is left
// alone. Skipped when a table is absent.
async function tableExists(db: Kysely<unknown>, table: string) {
	const { rows } = await sql<{ exists: boolean }>`
		SELECT to_regclass(${table}) IS NOT NULL AS exists
	`.execute(db);
	return rows[0]?.exists === true;
}

export async function up(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		for (const table of ["chain_reorgs", "blocks", "pending_fork_blocks"]) {
			if (!(await tableExists(db, table))) return;
		}
		await sql`SET lock_timeout = '30s'`.execute(db);
		for (const side of ["old", "new"] as const) {
			const column = sql.ref(`${side}_index_block_hash`);
			const named = sql.ref(`r.${side}_index_block_hash`);
			await sql`
				UPDATE chain_reorgs r
				   SET ${column} = COALESCE(
				       (SELECT b.index_block_hash FROM blocks b
				         WHERE b.height = r.fork_point_height AND b.hash = ${named}),
				       (SELECT NULLIF(p.payload->>'index_block_hash', '')
				          FROM pending_fork_blocks p
				         WHERE p.height = r.fork_point_height AND p.block_hash = ${named}
				         LIMIT 1))
				 WHERE ${named} IS NOT NULL
				   AND NOT EXISTS (SELECT 1 FROM blocks b
				         WHERE b.height = r.fork_point_height
				           AND b.index_block_hash = ${named})
				   AND NOT EXISTS (SELECT 1 FROM pending_fork_blocks p
				         WHERE p.height = r.fork_point_height
				           AND p.payload->>'index_block_hash' = ${named})
			`.execute(db);
		}
	});
}

export async function down(): Promise<void> {
	// Data repair: the block hashes it replaced were wrong, nothing to restore.
}
