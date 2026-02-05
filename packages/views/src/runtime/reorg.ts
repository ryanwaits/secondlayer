import { getDb, getRawClient } from "@secondlayer/shared/db";
import { listViews } from "@secondlayer/shared/db/queries/views";
import type { View } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import { getErrorMessage } from "@secondlayer/shared";
import { pgSchemaName } from "../schema/utils.ts";
import type { ViewDefinition, ViewSchema } from "../types.ts";
import { processBlock } from "./block-processor.ts";

/**
 * Handle a chain reorg for all active views.
 * Deletes rows at the reorged block height from all view tables,
 * then reprocesses the new canonical block.
 */
export async function handleViewReorg(
  blockHeight: number,
  loadViewDef: (handlerPath: string) => Promise<ViewDefinition>,
): Promise<void> {
  const db = getDb();
  const client = getRawClient();
  const activeViews = (await listViews(db)).filter((v: View) => v.status === "active");

  if (activeViews.length === 0) return;

  logger.info("Propagating reorg to views", { blockHeight, viewCount: activeViews.length });

  for (const view of activeViews) {
    try {
      const schema = (view.definition as any)?.schema as ViewSchema | undefined;
      if (!schema) continue;

      const schemaName = view.schema_name ?? pgSchemaName(view.name);

      // Delete rows at the reorged block height from all tables
      for (const tableName of Object.keys(schema)) {
        await client.unsafe(
          `DELETE FROM "${schemaName}"."${tableName}" WHERE "_block_height" = $1`,
          [blockHeight],
        );
      }

      logger.info("View reorg cleanup done", { view: view.name, blockHeight });

      // Reprocess the new canonical block
      const def = await loadViewDef(view.handler_path);
      await processBlock(def, view.name, blockHeight);

      logger.info("View reorg reprocessed", { view: view.name, blockHeight });
    } catch (err) {
      logger.error("View reorg handling failed", {
        view: view.name,
        blockHeight,
        error: getErrorMessage(err),
      });
    }
  }
}
