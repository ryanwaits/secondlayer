import type { Kysely } from "kysely";
import { sql } from "kysely";

// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
export async function up(db: Kysely<any>): Promise<void> {
	await sql`ALTER TABLE "streams" RENAME COLUMN "webhook_url" TO "endpoint_url"`.execute(
		db,
	);
	await sql`ALTER TABLE "streams" RENAME COLUMN "webhook_secret" TO "signing_secret"`.execute(
		db,
	);
}

// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
export async function down(db: Kysely<any>): Promise<void> {
	await sql`ALTER TABLE "streams" RENAME COLUMN "endpoint_url" TO "webhook_url"`.execute(
		db,
	);
	await sql`ALTER TABLE "streams" RENAME COLUMN "signing_secret" TO "webhook_secret"`.execute(
		db,
	);
}
