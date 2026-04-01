import { type Kysely, sql } from "kysely";
import type { Account, Database } from "../types.ts";

export async function upsertAccount(
	db: Kysely<Database>,
	email: string,
): Promise<Account> {
	return await db
		.insertInto("accounts")
		.values({ email })
		.onConflict(
			(oc) => oc.column("email").doUpdateSet({ email }), // no-op update to return existing
		)
		.returningAll()
		.executeTakeFirstOrThrow();
}

export async function getAccountById(
	db: Kysely<Database>,
	id: string,
): Promise<Account | null> {
	return (
		(await db
			.selectFrom("accounts")
			.selectAll()
			.where("id", "=", id)
			.executeTakeFirst()) ?? null
	);
}

export async function isEmailAllowed(
	db: Kysely<Database>,
	email: string,
): Promise<boolean> {
	const result = await sql<{ found: number }>`
    SELECT 1 AS found FROM accounts WHERE email = ${email}
    UNION ALL
    SELECT 1 AS found FROM waitlist WHERE email = ${email} AND status = 'approved'
    LIMIT 1
  `.execute(db);

	return result.rows.length > 0;
}

export async function createMagicLink(
	db: Kysely<Database>,
	email: string,
	token: string,
	expiresInMs: number = 15 * 60 * 1000,
): Promise<void> {
	await db
		.insertInto("magic_links")
		.values({
			email,
			token,
			expires_at: new Date(Date.now() + expiresInMs),
		})
		.execute();
}

/**
 * Verify a magic link token. Returns the email if valid, null otherwise.
 * Marks the token as used atomically. Rejects after 5 failed attempts.
 */
export async function verifyMagicLink(
	db: Kysely<Database>,
	token: string,
): Promise<string | null> {
	const result = await db
		.updateTable("magic_links")
		.set({ used_at: new Date() })
		.where("token", "=", token)
		.where("used_at", "is", null)
		.where("expires_at", ">", new Date())
		.where("failed_attempts", "<", 5)
		.returning("email")
		.executeTakeFirst();

	if (result?.email) return result.email;

	// Increment failed attempts if token exists but didn't verify
	await db
		.updateTable("magic_links")
		.set({ failed_attempts: sql`failed_attempts + 1` })
		.where("token", "=", token)
		.where("used_at", "is", null)
		.where("expires_at", ">", new Date())
		.execute();

	return null;
}
