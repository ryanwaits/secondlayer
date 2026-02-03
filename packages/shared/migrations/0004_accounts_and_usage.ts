import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  // 1. Create accounts table
  await db.schema
    .createTable("accounts")
    .addColumn("id", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("email", "text", (col) => col.unique().notNull())
    .addColumn("plan", "text", (col) => col.defaultTo("free").notNull())
    .addColumn("created_at", "timestamptz", (col) =>
      col.defaultTo(sql`NOW()`).notNull(),
    )
    .execute();

  // 2. Create magic_links table
  await db.schema
    .createTable("magic_links")
    .addColumn("id", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("email", "text", (col) => col.notNull())
    .addColumn("token", "text", (col) => col.unique().notNull())
    .addColumn("expires_at", "timestamptz", (col) => col.notNull())
    .addColumn("used_at", "timestamptz")
    .addColumn("created_at", "timestamptz", (col) =>
      col.defaultTo(sql`NOW()`).notNull(),
    )
    .execute();

  // 3. Create usage_daily table
  await db.schema
    .createTable("usage_daily")
    .addColumn("account_id", "uuid", (col) =>
      col.references("accounts.id").onDelete("cascade").notNull(),
    )
    .addColumn("date", "date", (col) => col.notNull())
    .addColumn("api_requests", "integer", (col) => col.defaultTo(0).notNull())
    .addColumn("deliveries", "integer", (col) => col.defaultTo(0).notNull())
    .execute();

  await sql`ALTER TABLE usage_daily ADD PRIMARY KEY (account_id, date)`.execute(db);

  // 4. Create usage_snapshots table
  await db.schema
    .createTable("usage_snapshots")
    .addColumn("id", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("account_id", "uuid", (col) =>
      col.references("accounts.id").onDelete("cascade").notNull(),
    )
    .addColumn("measured_at", "timestamptz", (col) =>
      col.defaultTo(sql`NOW()`).notNull(),
    )
    .addColumn("storage_bytes", "bigint", (col) => col.defaultTo(0).notNull())
    .execute();

  // 5. Add account_id FK to api_keys
  await db.schema
    .alterTable("api_keys")
    .addColumn("account_id", "uuid", (col) =>
      col.references("accounts.id").onDelete("cascade"),
    )
    .execute();

  // 6. Delete orphan api_keys (no account_id)
  await db.deleteFrom("api_keys").where("account_id", "is", null).execute();

  // 7. Set NOT NULL on account_id
  await sql`ALTER TABLE api_keys ALTER COLUMN account_id SET NOT NULL`.execute(db);

  // 8. Index for account_id lookups
  await db.schema
    .createIndex("api_keys_account_id_idx")
    .on("api_keys")
    .column("account_id")
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex("api_keys_account_id_idx").ifExists().execute();
  await sql`ALTER TABLE api_keys ALTER COLUMN account_id DROP NOT NULL`.execute(db);
  await db.schema.alterTable("api_keys").dropColumn("account_id").execute();
  await db.schema.dropTable("usage_snapshots").ifExists().execute();
  await db.schema.dropTable("usage_daily").ifExists().execute();
  await db.schema.dropTable("magic_links").ifExists().execute();
  await db.schema.dropTable("accounts").ifExists().execute();
}
