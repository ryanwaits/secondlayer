import type { Kysely } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable("waitlist")
    .addColumn("status", "text", (col) => col.notNull().defaultTo("pending"))
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable("waitlist").dropColumn("status").execute();
}
