import { type Kysely, sql } from "kysely";

/**
 * Remove the free Hobby plan from account state. Tenant rows must already
 * be gone because Hobby data cleanup is destructive/operator-owned.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	const liveHobby = await sql<{ count: string }>`
		SELECT count(*)::text AS count
		FROM tenants
		WHERE plan = 'hobby' AND status <> 'deleted'
	`.execute(db);
	if (liveHobby.rows[0]?.count !== "0") {
		throw new Error("Cannot remove Hobby while live Hobby tenants remain");
	}

	await sql`UPDATE accounts SET plan = 'none' WHERE plan = 'hobby'`.execute(db);
	await sql`ALTER TABLE accounts ALTER COLUMN plan SET DEFAULT 'none'`.execute(
		db,
	);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`ALTER TABLE accounts ALTER COLUMN plan SET DEFAULT 'hobby'`.execute(
		db,
	);
	await sql`UPDATE accounts SET plan = 'hobby' WHERE plan = 'none'`.execute(db);
}
