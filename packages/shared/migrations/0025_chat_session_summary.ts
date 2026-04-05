import type { Kysely } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
	await db.schema
		.alterTable("chat_sessions")
		.addColumn("summary", "jsonb")
		.execute();
}

export async function down(db: Kysely<any>): Promise<void> {
	await db.schema
		.alterTable("chat_sessions")
		.dropColumn("summary")
		.execute();
}
