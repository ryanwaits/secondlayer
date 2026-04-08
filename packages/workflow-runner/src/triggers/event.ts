import { getDb } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import { parseJsonb } from "@secondlayer/shared/db/jsonb";
import { matchSources } from "@secondlayer/subgraphs/runtime/source-matcher";
import type { SubgraphFilter } from "@secondlayer/subgraphs/types";
import { createWorkflowRun } from "@secondlayer/shared/db/queries/workflows";
import { enqueueWorkflowRun } from "../queue.ts";
import { createHash } from "node:crypto";

/** Track the last block height we checked for event triggers. */
let lastCheckedBlock = 0;

/**
 * Check for event/stream triggers that match new blocks.
 * Called on `streams:new_job` PG NOTIFY (when indexer commits a block).
 */
export async function checkEventTriggers(): Promise<void> {
	const db = getDb();

	// Get active workflow definitions with event or stream triggers
	const definitions = await db
		.selectFrom("workflow_definitions")
		.selectAll()
		.where("status", "=", "active")
		.where("trigger_type", "in", ["event", "stream"])
		.execute();

	if (definitions.length === 0) return;

	// Find new blocks since last check
	const blocks = await db
		.selectFrom("blocks")
		.selectAll()
		.where("height", ">", lastCheckedBlock)
		.where("canonical", "=", true)
		.orderBy("height", "asc")
		.limit(100)
		.execute();

	if (blocks.length === 0) return;

	for (const block of blocks) {
		// Load transactions and events for this block
		const transactions = await db
			.selectFrom("transactions")
			.selectAll()
			.where("block_height", "=", block.height)
			.execute();

		const events = await db
			.selectFrom("events")
			.selectAll()
			.where("block_height", "=", block.height)
			.execute();

		for (const def of definitions) {
			const triggerConfig = parseJsonb<{ filter: SubgraphFilter }>(
				def.trigger_config,
			);

			if (!triggerConfig?.filter) continue;

			// Use matchSources with a single named source
			const sources: Record<string, SubgraphFilter> = {
				trigger: triggerConfig.filter,
			};

			const matches = matchSources(
				sources,
				transactions.map((tx) => ({
					tx_id: tx.tx_id,
					type: tx.type,
					sender: tx.sender,
					status: tx.status,
					contract_id: tx.contract_id,
					function_name: tx.function_name,
					function_args: tx.function_args,
					raw_result: tx.raw_result,
				})),
				events.map((e) => ({
					id: e.id,
					tx_id: e.tx_id,
					type: e.type,
					event_index: e.event_index,
					data: e.data,
				})),
			);

			if (matches.length === 0) continue;

			const triggerData = {
				block: {
					height: block.height,
					hash: block.hash,
					timestamp: block.timestamp,
				},
				matches: matches.map((m) => ({
					txId: m.tx.tx_id,
					type: m.tx.type,
					sender: m.tx.sender,
					events: m.events,
				})),
			};

			// Dedup key prevents duplicate runs for same definition + block
			const dedupKey = createHash("sha256")
				.update(`${def.id}:${block.height}`)
				.digest("hex")
				.slice(0, 32);

			try {
				const run = await createWorkflowRun(db, {
					definitionId: def.id,
					triggerType: def.trigger_type,
					triggerData,
					dedupKey,
				});

				await enqueueWorkflowRun(run.id);

				logger.info("Workflow triggered by event", {
					workflow: def.name,
					runId: run.id,
					blockHeight: block.height,
					matchCount: matches.length,
				});
			} catch (err) {
				// Dedup constraint violation is expected — skip silently
				if (
					err instanceof Error &&
					err.message.includes("unique")
				) {
					continue;
				}
				logger.error("Failed to create workflow run from event trigger", {
					workflow: def.name,
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}

		lastCheckedBlock = block.height;
	}
}

/** Reset the cursor (used in tests or after reindex). */
export function resetEventCursor(blockHeight = 0): void {
	lastCheckedBlock = blockHeight;
}
