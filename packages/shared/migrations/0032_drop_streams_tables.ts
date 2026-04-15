import type { Kysely, Sql } from "kysely";

/**
 * Migration: Drop streams feature tables
 * 
 * This migration removes the entire streams feature from the database.
 * Tables are dropped in dependency order (child tables first):
 * 1. deliveries (references jobs and streams)
 * 2. jobs (references streams)
 * 3. stream_metrics (references streams)
 * 4. streams (main table)
 * 
 * Note: This is a destructive migration. All stream data will be lost.
 * Ensure you have a backup if you need to preserve historical data.
 * 
 * Associated code changes:
 * - PG NOTIFY channel renamed from "streams:new_job" to "indexer:new_block"
 *   (used by workflow-runner and subgraph processor for block notifications)
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	// Drop child tables first (in dependency order)
	
	// Drop deliveries table
	await db.schema.dropTable("deliveries").ifExists().execute();
	
	// Drop jobs table  
	await db.schema.dropTable("jobs").ifExists().execute();
	
	// Drop stream_metrics table
	await db.schema.dropTable("stream_metrics").ifExists().execute();
	
	// Drop main streams table
	await db.schema.dropTable("streams").ifExists().execute();
}

export async function down(_db: Kysely<Sql>): Promise<void> {
	// Restoration not supported - this is a destructive migration
	// To restore, you'd need to re-run the initial migration that created these tables
	throw new Error(
		"Down migration not supported for streams table removal. " +
		"To restore, restore from a backup or recreate the streams feature."
	);
}
