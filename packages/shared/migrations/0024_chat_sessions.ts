import { type Kysely, sql } from "kysely";

// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
export async function up(db: Kysely<any>): Promise<void> {
	await db.schema
		.createTable("chat_sessions")
		.addColumn("id", "uuid", (c) =>
			c.primaryKey().defaultTo(sql`gen_random_uuid()`),
		)
		.addColumn("account_id", "uuid", (c) =>
			c.notNull().references("accounts.id").onDelete("cascade"),
		)
		.addColumn("title", "text")
		.addColumn("created_at", "timestamptz", (c) =>
			c.notNull().defaultTo(sql`now()`),
		)
		.addColumn("updated_at", "timestamptz", (c) =>
			c.notNull().defaultTo(sql`now()`),
		)
		.execute();

	await sql`CREATE INDEX chat_sessions_account_idx ON chat_sessions (account_id, created_at DESC)`.execute(
		db,
	);

	await db.schema
		.createTable("chat_messages")
		.addColumn("id", "uuid", (c) =>
			c.primaryKey().defaultTo(sql`gen_random_uuid()`),
		)
		.addColumn("chat_session_id", "uuid", (c) =>
			c.notNull().references("chat_sessions.id").onDelete("cascade"),
		)
		.addColumn("role", "varchar(20)", (c) => c.notNull())
		.addColumn("parts", "jsonb", (c) => c.notNull())
		.addColumn("metadata", "jsonb")
		.addColumn("created_at", "timestamptz", (c) =>
			c.notNull().defaultTo(sql`now()`),
		)
		.execute();

	await sql`CREATE INDEX chat_messages_session_idx ON chat_messages (chat_session_id, created_at)`.execute(
		db,
	);
}

// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
export async function down(db: Kysely<any>): Promise<void> {
	await sql`DROP INDEX IF EXISTS chat_messages_session_idx`.execute(db);
	await db.schema.dropTable("chat_messages").execute();
	await sql`DROP INDEX IF EXISTS chat_sessions_account_idx`.execute(db);
	await db.schema.dropTable("chat_sessions").execute();
}
