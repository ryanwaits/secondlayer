import { timingSafeEqual } from "node:crypto";
import type { Account, Database } from "@secondlayer/shared/db";
import { type Kysely, sql } from "kysely";

/** First-party service account (`accounts.internal`): usage is recorded at
 *  $0 and no balance, floor or cap stops it. */
export async function isInternalAccount(
	db: Kysely<Database>,
	accountId: string,
): Promise<boolean> {
	const row = await db
		.selectFrom("accounts")
		.select("internal")
		.where("id", "=", accountId)
		.executeTakeFirst();
	return row?.internal === true;
}

/** Trim + lowercase: the one identity of an email address. Everything that
 *  stores or looks up an account or magic-link email goes through it, and
 *  `accounts_email_lower_idx` backs it up. */
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
		.onConflict((oc) => oc.doNothing())
		.returningAll()
		.executeTakeFirst();
	if (inserted) return { account: inserted, created: true };
	const raced = await db
		.selectFrom("accounts")
		.selectAll()
		.where(sql<boolean>`lower(email) = ${normalized}`)
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

/**
 * Persist the Stripe customer id, but only over the value the caller saw
 * (`null` on first use, the stale id when healing). Returns the id the
 * account ends up with: the caller's when it won, the concurrent winner's
 * when it lost the race.
 */
export async function setStripeCustomerId(
	db: Kysely<Database>,
	accountId: string,
	stripeCustomerId: string,
	replacing: string | null,
): Promise<string> {
	const won = await db
		.updateTable("accounts")
		.set({ stripe_customer_id: stripeCustomerId })
		.where("id", "=", accountId)
		.where(
			replacing === null
				? sql<boolean>`stripe_customer_id IS NULL`
				: sql<boolean>`stripe_customer_id = ${replacing}`,
		)
		.returning("stripe_customer_id")
		.executeTakeFirst();
	if (won?.stripe_customer_id) return won.stripe_customer_id;
	const current = await db
		.selectFrom("accounts")
		.select("stripe_customer_id")
		.where("id", "=", accountId)
		.executeTakeFirstOrThrow();
	return current.stripe_customer_id ?? stripeCustomerId;
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
	const normalized = normalizeEmail(email);
	const issue = async (trx: Kysely<Database>) => {
		// A new code voids every older unused one for this address, so only the
		// latest email in the inbox can sign in.
		await trx
			.updateTable("magic_links")
			.set({ used_at: new Date() })
			.where("email", "=", normalized)
			.where("used_at", "is", null)
			.execute();
		await trx
			.insertInto("magic_links")
			.values({
				email: normalized,
				token,
				code,
				expires_at: new Date(Date.now() + expiresInMs),
			})
			.execute();
	};
	if (db.isTransaction) await issue(db);
	else await db.transaction().execute(issue);
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

/** Guesses one set of codes for an address accepts before it locks. */
export const MAGIC_CODE_MAX_ATTEMPTS = 3;

/**
 * Verify by 6-digit code + email.
 *
 * Every attempt spends one try on every live code for the address, in ONE
 * statement that only touches rows still under the limit. The row lock makes
 * parallel guesses take turns: past `MAGIC_CODE_MAX_ATTEMPTS` the statement
 * returns nothing, so the code is never compared and a locked code can't be
 * opened even by its right value. Only after a try was granted is the code
 * compared, and a match is claimed (`used_at`) so it signs in once.
 */
export async function verifyMagicLinkByCode(
	db: Kysely<Database>,
	rawEmail: string,
	code: string,
): Promise<string | null> {
	const email = normalizeEmail(rawEmail);
	const granted = await db
		.updateTable("magic_links")
		.set({ failed_attempts: sql`failed_attempts + 1` })
		.where("email", "=", email)
		.where("used_at", "is", null)
		.where("expires_at", ">", new Date())
		.where("failed_attempts", "<", MAGIC_CODE_MAX_ATTEMPTS)
		.returning(["id", "code"])
		.execute();

	const match = granted.find((row) => sameCode(row.code, code));
	if (!match) return null;

	const claimed = await db
		.updateTable("magic_links")
		.set({ used_at: new Date() })
		.where("id", "=", match.id)
		.where("used_at", "is", null)
		.returning("email")
		.executeTakeFirst();
	return claimed?.email ?? null;
}

function sameCode(stored: string, given: string): boolean {
	const a = Buffer.from(stored);
	const b = Buffer.from(given);
	return a.length === b.length && timingSafeEqual(a, b);
}
