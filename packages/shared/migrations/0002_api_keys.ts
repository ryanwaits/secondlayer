import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("api_keys")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("key_hash", "text", (c) => c.notNull().unique())
    .addColumn("key_prefix", "text", (c) => c.notNull())
    .addColumn("name", "text")
    .addColumn("status", "text", (c) => c.notNull().defaultTo("active"))
    .addColumn("rate_limit", "integer", (c) => c.notNull().defaultTo(120))
    .addColumn("ip_address", "text", (c) => c.notNull())
    .addColumn("last_used_at", "timestamp")
    .addColumn("revoked_at", "timestamp")
    .addColumn("created_at", "timestamp", (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema.createIndex("api_keys_key_hash_idx").on("api_keys").column("key_hash").execute();
  await db.schema.createIndex("api_keys_status_idx").on("api_keys").column("status").execute();
  await db.schema.createIndex("api_keys_ip_address_idx").on("api_keys").column("ip_address").execute();

  // Add api_key_id to streams and views
  await db.schema
    .alterTable("streams")
    .addColumn("api_key_id", "uuid", (c) => c.references("api_keys.id"))
    .execute();

  await db.schema
    .alterTable("views")
    .addColumn("api_key_id", "uuid", (c) => c.references("api_keys.id"))
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable("views").dropColumn("api_key_id").execute();
  await db.schema.alterTable("streams").dropColumn("api_key_id").execute();
  await db.schema.dropTable("api_keys").ifExists().cascade().execute();
}
