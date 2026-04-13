import type { Kysely } from "kysely";

/**
 * Store the original TypeScript source of a workflow definition alongside
 * the bundled handler so agents can read, diff, and edit workflows in chat
 * without re-hydrating from a file. Nullable: rows deployed before this
 * migration remain read-only until their next redeploy.
 */
export async function up(db: Kysely<any>): Promise<void> {
	await db.schema
		.alterTable("workflow_definitions")
		.addColumn("source_code", "text")
		.execute();
}

export async function down(db: Kysely<any>): Promise<void> {
	await db.schema
		.alterTable("workflow_definitions")
		.dropColumn("source_code")
		.execute();
}
