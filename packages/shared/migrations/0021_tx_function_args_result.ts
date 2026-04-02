import type { Kysely } from "kysely";

/**
 * Add function_args and raw_result columns to transactions table.
 * Enables contract_call arg decoding and tx result access in subgraph handlers.
 */
export async function up(db: Kysely<any>): Promise<void> {
	await db.schema
		.alterTable("transactions")
		.addColumn("function_args", "jsonb")
		.execute();
	await db.schema
		.alterTable("transactions")
		.addColumn("raw_result", "text")
		.execute();
}

export async function down(db: Kysely<any>): Promise<void> {
	await db.schema
		.alterTable("transactions")
		.dropColumn("function_args")
		.execute();
	await db.schema
		.alterTable("transactions")
		.dropColumn("raw_result")
		.execute();
}
