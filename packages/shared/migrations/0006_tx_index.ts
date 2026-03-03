import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS tx_index INTEGER NOT NULL DEFAULT 0`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE transactions DROP COLUMN IF EXISTS tx_index`.execute(db);
}
