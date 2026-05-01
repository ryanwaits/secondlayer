import { type Kysely, sql } from "kysely";

// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
export async function up(db: Kysely<any>): Promise<void> {
	// Add start_block to subgraphs (the intended first block from definition)
	await sql`ALTER TABLE "subgraphs" ADD COLUMN "start_block" bigint NOT NULL DEFAULT 0`.execute(
		db,
	);

	// Backfill: existing subgraphs that have processed blocks started from 1
	await sql`UPDATE "subgraphs" SET "start_block" = 1 WHERE "last_processed_block" > 0`.execute(
		db,
	);

	// Subgraph gap tracking
	await sql`
    CREATE TABLE "subgraph_gaps" (
      "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "subgraph_id"    uuid NOT NULL REFERENCES "subgraphs"("id") ON DELETE CASCADE,
      "subgraph_name"  text NOT NULL,
      "gap_start"      bigint NOT NULL,
      "gap_end"        bigint NOT NULL,
      "reason"         text NOT NULL,
      "detected_at"    timestamptz NOT NULL DEFAULT now(),
      "resolved_at"    timestamptz
    )
  `.execute(db);

	await sql`CREATE INDEX "subgraph_gaps_subgraph_resolved_idx" ON "subgraph_gaps" ("subgraph_id", "resolved_at")`.execute(
		db,
	);
	await sql`CREATE INDEX "subgraph_gaps_name_idx" ON "subgraph_gaps" ("subgraph_name")`.execute(
		db,
	);
}

// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
export async function down(db: Kysely<any>): Promise<void> {
	await sql`DROP TABLE IF EXISTS "subgraph_gaps"`.execute(db);
	await sql`ALTER TABLE "subgraphs" DROP COLUMN "start_block"`.execute(db);
}
