import type { Account, Database } from "@secondlayer/shared/db";
import { type Kysely, sql } from "kysely";

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

/** Trim + lowercase. `upsertAccount` does not normalize; callers that take an
 *  email from another system (Sentinel) normalize first so one address is one
 *  account. */
export function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

/**
 * Find-or-create the account for an email, case-insensitively. `created` is
 * true only for the call that inserted the row (a concurrent loser sees
 * `created: false`), so it is safe to key first-time actions off it.
 */
export async function findOrCreateAccountByEmail(
	db: Kysely<Database>,
	email: string,
): Promise<{ account: Account; created: boolean }> {
	const normalized = normalizeEmail(email);
	const existing = await db
		.selectFrom("accounts")
		.selectAll()
		.where(sql<boolean>`lower(email) = ${normalized}`)
		.executeTakeFirst();
	if (existing) return { account: existing, created: false };
	const inserted = await db
		.insertInto("accounts")
		.values({ email: normalized })
		.onConflict((oc) => oc.column("email").doNothing())
		.returningAll()
		.executeTakeFirst();
	if (inserted) return { account: inserted, created: true };
	const raced = await db
		.selectFrom("accounts")
		.selectAll()
		.where("email", "=", normalized)
		.executeTakeFirstOrThrow();
	return { account: raced, created: false };
}

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Record that Sentinel may touch this account. Idempotent: an existing row
 *  (and its original `via`) is kept. */
export async function linkSentinelAccount(
	db: Kysely<Database>,
	accountId: string,
	via: "created" | "consent",
): Promise<void> {
	await db
		.insertInto("sentinel_accounts")
		.values({ account_id: accountId, via })
		.onConflict((oc) => oc.column("account_id").doNothing())
		.execute();
}

export async function isSentinelLinked(
	db: Kysely<Database>,
	accountId: string,
): Promise<boolean> {
	const row = await db
		.selectFrom("sentinel_accounts")
		.select("account_id")
		.where("account_id", "=", accountId)
		.executeTakeFirst();
	return row !== undefined;
}

/** Subset of `accountIds` that Sentinel may touch. */
export async function sentinelLinkedIds(
	db: Kysely<Database>,
	accountIds: string[],
): Promise<Set<string>> {
	const valid = accountIds.filter((id) => UUID_RE.test(id));
	if (valid.length === 0) return new Set();
	const rows = await db
		.selectFrom("sentinel_accounts")
		.select("account_id")
		.where("account_id", "in", valid)
		.execute();
	return new Set(rows.map((r) => r.account_id));
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
		notify_reindex_complete?: boolean;
	},
): Promise<Account> {
	const set: Record<string, unknown> = {};
	if (data.display_name !== undefined) set.display_name = data.display_name;
	if (data.bio !== undefined) set.bio = data.bio;
	if (data.notify_reindex_complete !== undefined)
		set.notify_reindex_complete = data.notify_reindex_complete;

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
