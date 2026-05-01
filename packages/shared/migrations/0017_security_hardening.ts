import { type Kysely, sql } from "kysely";

// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
export async function up(db: Kysely<any>): Promise<void> {
	// Magic link: add failed attempt tracking
	await sql`ALTER TABLE "magic_links" ADD COLUMN "failed_attempts" integer NOT NULL DEFAULT 0`.execute(
		db,
	);

	// Ownership: clean up any NULL api_key_id rows
	await sql`DELETE FROM "streams" WHERE "api_key_id" IS NULL`.execute(db);
	await sql`DELETE FROM "subgraphs" WHERE "api_key_id" IS NULL`.execute(db);

	// Ownership: enforce NOT NULL going forward
	await sql`ALTER TABLE "streams" ALTER COLUMN "api_key_id" SET NOT NULL`.execute(
		db,
	);
	await sql`ALTER TABLE "subgraphs" ALTER COLUMN "api_key_id" SET NOT NULL`.execute(
		db,
	);
}

// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
export async function down(db: Kysely<any>): Promise<void> {
	await sql`ALTER TABLE "magic_links" DROP COLUMN "failed_attempts"`.execute(
		db,
	);
	await sql`ALTER TABLE "streams" ALTER COLUMN "api_key_id" DROP NOT NULL`.execute(
		db,
	);
	await sql`ALTER TABLE "subgraphs" ALTER COLUMN "api_key_id" DROP NOT NULL`.execute(
		db,
	);
}
