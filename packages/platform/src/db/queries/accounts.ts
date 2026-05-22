import { type Kysely, sql } from "kysely";
import type { Account, Database } from "@secondlayer/shared/db";

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

export async function updateAccountProfile(
	db: Kysely<Database>,
	id: string,
	data: {
		display_name?: string;
		bio?: string;
		slug?: string;
	},
): Promise<Account> {
	const set: Record<string, unknown> = {};
	if (data.display_name !== undefined) set.display_name = data.display_name;
	if (data.bio !== undefined) set.bio = data.bio;
	if (data.slug !== undefined) set.slug = data.slug;

	return db
		.updateTable("accounts")
		.set(set)
		.where("id", "=", id)
		.returningAll()
		.executeTakeFirstOrThrow();
}

/** Persist the Stripe customer id on first upgrade (lazy customer model). */
export async function setStripeCustomerId(
	db: Kysely<Database>,
	accountId: string,
	stripeCustomerId: string,
): Promise<void> {
	await db
		.updateTable("accounts")
		.set({ stripe_customer_id: stripeCustomerId })
		.where("id", "=", accountId)
		.execute();
}

/**
 * Set the plan tier on an account. Called by the Stripe webhook on
 * subscription lifecycle events + by the billing page's fast-resolve
 * after a successful Checkout redirect. Returns true if a row was
 * updated (account exists).
 */
export async function setAccountPlan(
	db: Kysely<Database>,
	accountId: string,
	plan: string,
): Promise<boolean> {
	const result = await db
		.updateTable("accounts")
		.set({ plan })
		.where("id", "=", accountId)
		.executeTakeFirst();
	return (result.numUpdatedRows ?? 0n) > 0n;
}

/** Resolve an account by its Stripe customer id. Null if no match. */
export async function getAccountByStripeCustomerId(
	db: Kysely<Database>,
	stripeCustomerId: string,
): Promise<{ id: string } | null> {
	const row = await db
		.selectFrom("accounts")
		.select("id")
		.where("stripe_customer_id", "=", stripeCustomerId)
		.executeTakeFirst();
	return row ?? null;
}

export async function isSlugTaken(
	db: Kysely<Database>,
	slug: string,
	excludeAccountId: string,
): Promise<boolean> {
	const row = await db
		.selectFrom("accounts")
		.select("id")
		.where("slug", "=", slug)
		.where("id", "!=", excludeAccountId)
		.executeTakeFirst();
	return !!row;
}

export async function createMagicLink(
	db: Kysely<Database>,
	email: string,
	token: string,
	code: string,
	expiresInMs: number = 15 * 60 * 1000,
): Promise<void> {
	await db
		.insertInto("magic_links")
		.values({
			email,
			token,
			code,
			expires_at: new Date(Date.now() + expiresInMs),
		})
		.execute();
}

/**
 * Verify a magic link token. Returns the email if valid, null otherwise.
 * Marks the token as used atomically. Rejects after 3 failed attempts.
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
		.where("failed_attempts", "<", 3)
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

/**
 * Verify by 6-digit code + email. Same atomic pattern as verifyMagicLink.
 * Rejects after 3 failed attempts. Increments failed_attempts on all
 * active codes for this email on failure (prevents parallel brute-force).
 */
export async function verifyMagicLinkByCode(
	db: Kysely<Database>,
	email: string,
	code: string,
): Promise<string | null> {
	const result = await db
		.updateTable("magic_links")
		.set({ used_at: new Date() })
		.where("email", "=", email)
		.where("code", "=", code)
		.where("used_at", "is", null)
		.where("expires_at", ">", new Date())
		.where("failed_attempts", "<", 3)
		.returning("email")
		.executeTakeFirst();

	if (result?.email) return result.email;

	// Increment failed attempts on all active codes for this email
	await db
		.updateTable("magic_links")
		.set({ failed_attempts: sql`failed_attempts + 1` })
		.where("email", "=", email)
		.where("used_at", "is", null)
		.where("expires_at", ">", new Date())
		.execute();

	return null;
}
