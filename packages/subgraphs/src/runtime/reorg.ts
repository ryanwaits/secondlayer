import { getErrorMessage } from "@secondlayer/shared";
import { getDb, getRawClient } from "@secondlayer/shared/db";
import type { Subgraph } from "@secondlayer/shared/db";
import { listSubgraphs } from "@secondlayer/shared/db/queries/subgraphs";
import { logger } from "@secondlayer/shared/logger";
import { pgSchemaName } from "../schema/utils.ts";
import type { SubgraphDefinition, SubgraphSchema } from "../types.ts";
import { processBlock } from "./block-processor.ts";

/**
 * Handle a chain reorg for all active subgraphs.
 * Deletes rows at the reorged block height from all subgraph tables,
 * then reprocesses the new canonical block.
 */
export async function handleSubgraphReorg(
	blockHeight: number,
	loadSubgraphDef: (sg: Subgraph) => Promise<SubgraphDefinition>,
): Promise<void> {
	const db = getDb();
	const client = getRawClient();
	const activeSubgraphs = (await listSubgraphs(db)).filter(
		(v: Subgraph) => v.status === "active",
	);

	if (activeSubgraphs.length === 0) return;

	logger.info("Propagating reorg to subgraphs", {
		blockHeight,
		subgraphCount: activeSubgraphs.length,
	});

	for (const sg of activeSubgraphs) {
		try {
			const schema = sg.definition.schema as SubgraphSchema | undefined;
			if (!schema) continue;

			const schemaName = sg.schema_name ?? pgSchemaName(sg.name);

			// Delete rows at the reorged block height from all tables
			for (const tableName of Object.keys(schema)) {
				await client.unsafe(
					`DELETE FROM "${schemaName}"."${tableName}" WHERE "_block_height" = $1`,
					[blockHeight],
				);
			}

			logger.info("Subgraph reorg cleanup done", {
				subgraph: sg.name,
				blockHeight,
			});

			// Reprocess the new canonical block
			const def = await loadSubgraphDef(sg);
			await processBlock(def, sg.name, blockHeight);

			logger.info("Subgraph reorg reprocessed", {
				subgraph: sg.name,
				blockHeight,
			});
		} catch (err) {
			logger.error("Subgraph reorg handling failed", {
				subgraph: sg.name,
				blockHeight,
				error: getErrorMessage(err),
			});
		}
	}
}
