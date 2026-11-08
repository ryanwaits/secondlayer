import { getErrorMessage } from "@secondlayer/shared";
import { getRawClient, getTargetDb } from "@secondlayer/shared/db";
import type { Subgraph } from "@secondlayer/shared/db";
import {
	createSubgraphOperation,
	isActiveSubgraphOperationConflict,
	requestSubgraphOperationCancel,
	waitForSubgraphOperationsClear,
} from "@secondlayer/shared/db/queries/subgraph-operations";
import {
	getSubgraph,
	listSubgraphs,
	setReindexCursor,
} from "@secondlayer/shared/db/queries/subgraphs";
import { logger } from "@secondlayer/shared/logger";
import { sql } from "kysely";
import { pgSchemaName } from "../schema/utils.ts";
import type { SubgraphDefinition, SubgraphSchema } from "../types.ts";
import { processBlock } from "./block-processor.ts";
import {
	bumpReorgEpoch,
	withSubgraphBlockAdvisoryLock,
	withSubgraphBlockLock,
} from "./catchup.ts";

/** How long a reorg waits for a reindex walk to stop before it gives up on
 *  that subgraph (logged; the next reorg or a reindex repairs it). */
const REINDEX_STOP_TIMEOUT_MS = 30_000;

/**
 * Handle a chain reorg for all active and reindexing subgraphs.
 *
 * `blockHeight` is the **shallowest** height where the chain diverged. The
 * indexer's `handleReorg` has already marked every block ≥ `blockHeight`
 * as non-canonical (a Stacks reorg can span many blocks). We mirror that
 * here: delete rows where `_block_height >= blockHeight` from every
 * subgraph table, then reprocess `blockHeight` (subsequent heights will
 * be reprocessed as the indexer ingests new-chain blocks).
 */
export async function handleSubgraphReorg(
	blockHeight: number,
	loadSubgraphDef: (sg: Subgraph) => Promise<SubgraphDefinition>,
): Promise<void> {
	// The subgraphs registry and every subgraph's data plane live on the
	// managed target DB.
	const targetDb = getTargetDb();
	const activeSubgraphs = (await listSubgraphs(targetDb)).filter(
		(v: Subgraph) =>
			v.status === "active" ||
			v.status === "reindexing" ||
			v.status === "error",
	);

	if (activeSubgraphs.length === 0) return;

	logger.info("Propagating reorg to subgraphs", {
		blockHeight,
		subgraphCount: activeSubgraphs.length,
	});

	for (const sg of activeSubgraphs) {
		try {
			await rewindSubgraphToFork(sg, blockHeight, loadSubgraphDef);
		} catch (err) {
			logger.error("Subgraph reorg handling failed", {
				subgraph: sg.name,
				blockHeight,
				error: getErrorMessage(err),
			});
		}
	}
}

/**
 * The per-subgraph reorg sequence: bump the epoch, stop a reindex walk behind
 * the fork, then revert and reprocess under all three locks. Called for every
 * subgraph by {@link handleSubgraphReorg}, and alone by the catch-up check that
 * finds a reorg whose NOTIFY the processor missed. Throws on failure.
 */
export async function rewindSubgraphToFork(
	sg: Subgraph,
	blockHeight: number,
	loadSubgraphDef: (sg: Subgraph) => Promise<SubgraphDefinition>,
): Promise<void> {
	const schema = sg.definition.schema as SubgraphSchema | undefined;
	if (!schema) return;

	// f057: bump this subgraph's reorg epoch BEFORE taking the block lock
	// (visible immediately, however long the lock wait takes), then hold
	// the lock for the whole delete+reprocess+rewind sequence below. A
	// catch-up walk in flight either (a) is between blocks and about to
	// acquire the lock — it will see the bumped epoch and abort without
	// writing, or (b) already holds the lock for one in-flight block —
	// we wait for it to finish, then proceed; its NEXT block sees the
	// bumped epoch and aborts. Either way our rewind write below is never
	// clobbered by a catch-up write that doesn't know the cursor moved.
	// See the guard comment near `subgraphBlockLockHeld` in catchup.ts.
	bumpReorgEpoch(sg.name);
	// A reindex walk runs in its own loop with a cursor of its own, so a
	// fork at or below that cursor orphans rows the walk will never
	// revisit. Stop the walk BEFORE taking the block locks: the walk needs
	// them for every block it writes, so waiting on it while holding them
	// would never finish.
	if (!(await stopReindexBehindFork(sg, blockHeight))) return;
	await withSubgraphBlockLock(sg.name, async () => {
		// f069: the in-process block lock above only excludes a same-process
		// catch-up walk (f057) — `handleSubgraphReorg` itself runs on EVERY
		// process (NOTIFY fan-out from processor.ts), so two processes could
		// otherwise run this exact revert+reprocess sequence for the same
		// subgraph concurrently, double-applying the fork block or racing
		// each other's journal restore. A Postgres advisory lock scoped to
		// a wrapping transaction on the managed (target) DB closes that:
		// held for the WHOLE delete+reprocess+rewind sequence below, since
		// `pg_advisory_xact_lock` releases only when this transaction
		// commits/rolls back — regardless of how long the callback runs or
		// what other connections (the subgraph's own data-plane client,
		// `processBlock`'s own separate managed-DB transaction) it awaits
		// in the meantime. Transaction-scoped (not session-scoped): nothing
		// here needs the lock to outlive this one call, and an xact lock
		// can never leak past a crash the way a session lock without a
		// matching `finally` unlock could.
		await getTargetDb()
			.transaction()
			.execute(async (lockTx) => {
				await sql`SELECT pg_advisory_xact_lock(hashtext(${`subgraph-reorg:${sg.name}`}))`.execute(
					lockTx,
				);
				// Lock 3 (see catchup.ts): excludes a backfill or reindex
				// walk's block write for the whole revert.
				await withSubgraphBlockAdvisoryLock(sg.name, () =>
					reorgOneSubgraph(sg, schema, blockHeight, loadSubgraphDef),
				);
			});
	});
}

/**
 * A reindexing subgraph whose cursor is at or past the fork has rows above the
 * fork. Ask its operation to stop and wait for the runner to release it.
 * Returns `false` when the walk would not stop, so nothing is reverted under
 * a walk that keeps writing. A fork above the cursor, or a subgraph that is
 * not reindexing, needs no stop.
 */
async function stopReindexBehindFork(
	sg: Subgraph,
	blockHeight: number,
): Promise<boolean> {
	const targetDb = getTargetDb();
	const row = await getSubgraph(targetDb, sg.name);
	if (!row || row.status !== "reindexing") return true;
	if (Number(row.last_processed_block) < blockHeight) return true;

	await requestSubgraphOperationCancel(targetDb, row.id);
	const cleared = await waitForSubgraphOperationsClear(targetDb, row.id, {
		timeoutMs: REINDEX_STOP_TIMEOUT_MS,
	});
	if (!cleared) {
		logger.error(
			"Reorg could not stop the reindex walk, subgraph not reverted",
			{ subgraph: sg.name, blockHeight },
		);
	}
	return cleared;
}

/**
 * Moves the cursor back to `height` in the transaction that reverts the rows
 * above it, so a crash or a skipped reprocess can never leave a cursor claiming
 * rows the revert removed. Moves backward only; a reindexing subgraph's cursor
 * is handled by its queued reindex op instead.
 */
async function rewindCursorTo(
	tx: Pick<ReturnType<typeof getRawClient>, "unsafe">,
	subgraphId: string,
	height: number,
): Promise<void> {
	await tx.unsafe(
		`UPDATE subgraphs SET last_processed_block = $1, updated_at = now()
		 WHERE id = $2 AND status IN ('active', 'error') AND last_processed_block > $1`,
		[Math.max(0, height), subgraphId],
	);
}

/** The per-subgraph revert+reprocess sequence, run while holding both the
 *  in-process block lock (f057) and the cross-process advisory lock (f069,
 *  see the call site in {@link handleSubgraphReorg}). */
async function reorgOneSubgraph(
	sg: Subgraph,
	schema: SubgraphSchema,
	blockHeight: number,
	loadSubgraphDef: (sg: Subgraph) => Promise<SubgraphDefinition>,
): Promise<void> {
	const targetDb = getTargetDb();
	// State as of now, under the locks: the row the caller listed may have been
	// halted, finished or cancelled since.
	const current = await getSubgraph(targetDb, sg.name);
	// Deleted, or registered again under the same name: the new row has nothing
	// of the orphaned range to revert.
	if (!current || current.id !== sg.id) return;
	// A halted subgraph keeps its rows and cursor; they must match the chain
	// when it resumes, so it is reverted and rewound like a running one.
	if (!["active", "reindexing", "error"].includes(current.status)) return;
	// A cursor below the fork wrote nothing from the orphaned range.
	if (Number(current.last_processed_block) < blockHeight) return;
	const schemaName = sg.schema_name ?? pgSchemaName(sg.name);
	// Rows live on the managed target DB.
	const client = getRawClient("target");

	const tableNames = Object.keys(schema);

	// Revert table state. With a journal: restore each touched row to its
	// pre-fork state (accumulators keep their history — fix-f040 B2), then
	// sweep append-only rows created at/after the fork. Without one
	// (pre-journal deploy), fall back to the height sweep alone — correct
	// only for append-only tables.
	const hasJournal = (
		await client.unsafe<{ r: unknown }[]>(
			`SELECT to_regclass('"${schemaName}"."_journal"') AS r`,
		)
	)[0]?.r;
	if (hasJournal) {
		await client.begin(async (tx) => {
			for (const tableName of tableNames) {
				// Pre-fork state per row = prev_row of the EARLIEST journal
				// entry at/after the fork (pre-images compose: the first one
				// captured is the state before any fork-era op touched it).
				// prev_row NULL = the row was created in the fork era.
				const earliest = `
					SELECT DISTINCT ON (row_key) row_key, prev_row
					FROM "${schemaName}"."_journal"
					WHERE block_height >= $1 AND table_name = $2
					ORDER BY row_key, _jid ASC`;
				// 1. Drop the current (orphaned) versions of journaled rows.
				await tx.unsafe(
					`DELETE FROM "${schemaName}"."${tableName}" t USING (${earliest}) e WHERE to_jsonb(t.*) @> e.row_key`,
					[blockHeight, tableName],
				);
				// 2. Sweep append-only rows born at/after the fork.
				await tx.unsafe(
					`DELETE FROM "${schemaName}"."${tableName}" WHERE "_block_height" >= $1`,
					[blockHeight],
				);
				// 3. Restore pre-fork row states (pure SQL — NUMERIC precision
				// never round-trips through JS). Restored rows were created
				// pre-fork, so step 2 cannot have matched them.
				await tx.unsafe(
					`INSERT INTO "${schemaName}"."${tableName}"
					 SELECT r.* FROM (${earliest}) e
					 CROSS JOIN LATERAL jsonb_populate_record(NULL::"${schemaName}"."${tableName}", e.prev_row) r
					 WHERE e.prev_row IS NOT NULL`,
					[blockHeight, tableName],
				);
			}
			await tx.unsafe(
				`DELETE FROM "${schemaName}"."_journal" WHERE block_height >= $1`,
				[blockHeight],
			);
			await rewindCursorTo(tx, sg.id, blockHeight - 1);
		});
	} else {
		logger.warn(
			"Subgraph has no revert journal — falling back to height delete (accumulator rows may lose history)",
			{ subgraph: sg.name, blockHeight },
		);
		await client.begin(async (tx) => {
			for (const tableName of tableNames) {
				await tx.unsafe(
					`DELETE FROM "${schemaName}"."${tableName}" WHERE "_block_height" >= $1`,
					[blockHeight],
				);
			}
			await rewindCursorTo(tx, sg.id, blockHeight - 1);
		});
	}

	// Factory-discovered addresses are chain-derived state like any
	// row: an address revealed on the orphaned fork must not keep
	// matching forever. `IF EXISTS` because the table is only
	// created for subgraphs that actually use a factory.
	await client.unsafe(
		`DO $$ BEGIN
			IF to_regclass('"${schemaName}"."_factory_addresses"') IS NOT NULL THEN
				DELETE FROM "${schemaName}"."_factory_addresses" WHERE block_height >= ${Number(blockHeight)};
			END IF;
		END $$`,
	);

	// Print-validate skips live on the control plane (same DB as `subgraphs`),
	// not in the per-subgraph schema. Clear orphan rows that would accuse the
	// live chain of a mismatch that only existed on the rolled-back fork.
	await targetDb
		.deleteFrom("subgraph_violations")
		.where("subgraph_name", "=", sg.name)
		.where("block_height", ">=", blockHeight)
		.execute();

	logger.info("Subgraph reorg cleanup done", {
		subgraph: sg.name,
		blockHeight,
	});

	if (current.status === "reindexing") {
		// No runner stopped it (a stranded reindex): the cursor goes back to just
		// before the fork and a queued reindex op resumes the walk from there.
		await setReindexCursor(targetDb, sg.id, Math.max(0, blockHeight - 1));
		try {
			await createSubgraphOperation(targetDb, {
				subgraphId: current.id,
				subgraphName: current.name,
				accountId: current.account_id,
				kind: "reindex",
			});
		} catch (err) {
			if (!isActiveSubgraphOperationConflict(err)) throw err;
		}
		logger.info("Subgraph reorg rewound a reindex", {
			subgraph: sg.name,
			blockHeight,
		});
		return;
	}

	// A halted subgraph stays halted: only a redeploy or reindex resumes it, and
	// either one rebuilds from the rewound cursor.
	if (current.status === "error") {
		logger.info("Subgraph reorg rewound a halted subgraph", {
			subgraph: sg.name,
			blockHeight,
		});
		return;
	}

	// Reprocess the new canonical block. Subsequent blocks above
	// `blockHeight` will be reprocessed as the indexer ingests
	// them — they're already marked non-canonical by handleReorg.
	// f069: reorgRewind bypasses the live-path replay guard (this height is,
	// by construction, at or below the current cursor) and writes the
	// checkpoint unconditionally via rewindLiveProgress, moving it backward
	// to the fork height instead of skipping as "already applied."
	const def = await loadSubgraphDef(sg);
	await processBlock(def, sg.name, blockHeight, {
		reorgRewind: true,
		subgraphId: sg.id,
	});

	logger.info("Subgraph reorg reprocessed", {
		subgraph: sg.name,
		blockHeight,
	});
}
