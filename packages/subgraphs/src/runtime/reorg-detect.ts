import { getErrorMessage } from "@secondlayer/shared";
import type { Subgraph } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import type { SubgraphDefinition } from "../types.ts";
import { resolveBlockSource } from "./block-source.ts";
import { rewindSubgraphToFork } from "./reorg.ts";

/**
 * Finds subgraphs whose cursor sits on a block that is no longer canonical and
 * rewinds each one the way the reorg NOTIFY would have.
 *
 * The NOTIFY is fire-and-forget: a processor that was down, or not listening
 * yet, never hears about a reorg that happened meanwhile, and the subgraph then
 * keeps rows from the orphaned fork forever. Every progress write records the
 * hash of the block it reached (`last_processed_block_hash`); a mismatch with
 * the canonical hash at that height means the chain moved under the cursor.
 *
 * The fork point is the shallowest recorded reorg that orphaned the cursor
 * block, or the cursor block itself when the source has no such record. A
 * subgraph with no stored hash (see migration 0197) or a height with no
 * canonical block yet (a reorg mid-flight, whose NOTIFY is on its way) is left
 * alone, and the next pass looks again.
 */
export async function rewindMissedReorgs(
	subgraphs: Subgraph[],
	loadSubgraphDef: (sg: Subgraph) => Promise<SubgraphDefinition>,
): Promise<void> {
	// Subgraphs sharing a cursor height share one hash lookup this pass.
	const canonicalHashes = new Map<number, Promise<string | null>>();

	for (const sg of subgraphs) {
		const stored = sg.last_processed_block_hash;
		const cursor = Number(sg.last_processed_block);
		if (!stored || cursor <= 0) continue;
		try {
			const source = await resolveBlockSource(await loadSubgraphDef(sg));
			if (!source.getBlockHash) continue;
			let canonical = canonicalHashes.get(cursor);
			if (!canonical) {
				canonical = source.getBlockHash(cursor);
				canonicalHashes.set(cursor, canonical);
			}
			const hash = await canonical;
			if (hash === null || hash === stored) continue;

			const fork = Math.max(
				1,
				(await source.findReorgFork?.(cursor)) ?? cursor,
			);
			logger.warn("Subgraph cursor is on an orphaned block, rewinding", {
				subgraph: sg.name,
				cursor,
				storedHash: stored,
				canonicalHash: hash,
				forkHeight: fork,
			});
			await rewindSubgraphToFork(sg, fork, loadSubgraphDef);
		} catch (err) {
			logger.error("Missed-reorg check failed", {
				subgraph: sg.name,
				error: getErrorMessage(err),
			});
		}
	}
}
