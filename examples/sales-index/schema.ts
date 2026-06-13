import { Kysely, PostgresDialect, sql } from "kysely";
import pg from "pg";

// Your app's index: one row per marketplace sale, plus the checkpoint row
// that makes the loop resumable. You own this database — Secondlayer never
// sees it. (For a full mirror of Index rows instead, `sl index codegen
// --target kysely` emits the drift-tested schema.)
export interface Database {
	sales: {
		tx_id: string;
		cursor: string;
		block_height: number;
		buyer: string;
		collection: string;
		token_id: string;
	};
	checkpoints: {
		id: string;
		cursor: string;
	};
}

export const db = new Kysely<Database>({
	dialect: new PostgresDialect({
		pool: new pg.Pool({ connectionString: process.env.DATABASE_URL }),
	}),
});

export async function migrate(): Promise<void> {
	await sql`
		CREATE TABLE IF NOT EXISTS sales (
			tx_id text PRIMARY KEY,
			cursor text NOT NULL,
			block_height integer NOT NULL,
			buyer text NOT NULL,
			collection text NOT NULL,
			token_id text NOT NULL
		);
		CREATE TABLE IF NOT EXISTS checkpoints (
			id text PRIMARY KEY,
			cursor text NOT NULL
		);
	`.execute(db);
}

export async function loadCheckpoint(): Promise<string | null> {
	const row = await db
		.selectFrom("checkpoints")
		.select("cursor")
		.where("id", "=", "sales")
		.executeTakeFirst();
	return row?.cursor ?? null;
}
