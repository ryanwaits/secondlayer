import { type Kysely, sql } from "kysely";

/**
 * Service heartbeats — a tiny liveness table that long-running services
 * (subgraph-processor, l2-decoder, etc.) upsert into periodically. The
 * platform `/public/status` route reads it to surface "is this service
 * actually running" without needing in-cluster docker inspection.
 */
// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
export async function up(db: Kysely<any>): Promise<void> {
	await db.schema
		.createTable("service_heartbeats")
		.addColumn("name", "text", (c) => c.primaryKey())
		.addColumn("updated_at", "timestamptz", (c) =>
			c.notNull().defaultTo(sql`now()`),
		)
		.execute();
}

// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
export async function down(db: Kysely<any>): Promise<void> {
	await db.schema.dropTable("service_heartbeats").execute();
}
