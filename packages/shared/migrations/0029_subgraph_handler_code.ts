import type { Kysely } from "kysely";

/**
 * Store bundled handler code in the subgraphs table so it can be
 * regenerated on container restart without requiring a redeploy.
 *
 * Fixes: handler files in /data/subgraphs/ live in the container's
 * writable layer and are lost on container recreation (e.g. CI deploys).
 * With handler_code stored in DB, the API can restore the file on startup.
 */
export async function up(db: Kysely<any>): Promise<void> {
	await db.schema
		.alterTable("subgraphs")
		.addColumn("handler_code", "text")
		.execute();
}

export async function down(db: Kysely<any>): Promise<void> {
	await db.schema
		.alterTable("subgraphs")
		.dropColumn("handler_code")
		.execute();
}
