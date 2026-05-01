import type { Kysely } from "kysely";

/**
 * Store the original TypeScript source of a subgraph alongside the bundled
 * handler so agents can read, diff, and edit subgraphs in chat without
 * re-hydrating from a file. Nullable: rows deployed before this migration
 * remain read-only until their next redeploy.
 */
// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
export async function up(db: Kysely<any>): Promise<void> {
	await db.schema
		.alterTable("subgraphs")
		.addColumn("source_code", "text")
		.execute();
}

// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
export async function down(db: Kysely<any>): Promise<void> {
	await db.schema.alterTable("subgraphs").dropColumn("source_code").execute();
}
