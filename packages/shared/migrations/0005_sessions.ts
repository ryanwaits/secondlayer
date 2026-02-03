import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("sessions")
    .addColumn("id", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("token_hash", "text", (col) => col.unique().notNull())
    .addColumn("token_prefix", "text", (col) => col.notNull())
    .addColumn("account_id", "uuid", (col) =>
      col.references("accounts.id").onDelete("cascade").notNull(),
    )
    .addColumn("ip_address", "text", (col) => col.notNull())
    .addColumn("expires_at", "timestamptz", (col) =>
      col.defaultTo(sql`NOW() + INTERVAL '90 days'`).notNull(),
    )
    .addColumn("revoked_at", "timestamptz")
    .addColumn("last_used_at", "timestamptz")
    .addColumn("created_at", "timestamptz", (col) =>
      col.defaultTo(sql`NOW()`).notNull(),
    )
    .execute();

  await db.schema
    .createIndex("sessions_token_hash_idx")
    .on("sessions")
    .column("token_hash")
    .execute();

  await db.schema
    .createIndex("sessions_account_id_idx")
    .on("sessions")
    .column("account_id")
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex("sessions_account_id_idx").ifExists().execute();
  await db.schema.dropIndex("sessions_token_hash_idx").ifExists().execute();
  await db.schema.dropTable("sessions").ifExists().execute();
}
