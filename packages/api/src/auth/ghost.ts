import type { getDb } from "@secondlayer/shared/db";
import { hashToken } from "./keys.ts";

/**
 * Ghost-account claim tokens. The raw token is embedded in the claim URL
 * returned ONCE at mint time; only its sha256 is stored. Claiming exchanges the
 * token + a verified email for ownership of the ghost account (or merges the
 * ghost's keys into an existing account for that email).
 */

export const CLAIM_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

type Db = ReturnType<typeof getDb>;

export function generateClaimToken(): { raw: string; hash: string } {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	const raw = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
		"",
	);
	return { raw, hash: hashToken(raw) };
}

export async function createClaimToken(
	db: Db,
	accountId: string,
): Promise<{ raw: string; expiresAt: Date }> {
	const { raw, hash } = generateClaimToken();
	const expiresAt = new Date(Date.now() + CLAIM_TOKEN_TTL_MS);
	await db
		.insertInto("claim_tokens")
		.values({ account_id: accountId, token_hash: hash, expires_at: expiresAt })
		.execute();
	return { raw, expiresAt };
}

/**
 * Resolve a raw claim token to its ghost account if (and only if) the token is
 * unexpired, unused, and the account is still an unclaimed ghost. Read-only —
 * used for the "send magic link" phase, which must not burn the token.
 */
export async function validateClaimToken(
	db: Db,
	rawToken: string,
): Promise<{ tokenId: string; accountId: string } | null> {
	const row = await db
		.selectFrom("claim_tokens")
		.innerJoin("accounts", "accounts.id", "claim_tokens.account_id")
		.select(["claim_tokens.id as id", "claim_tokens.account_id as account_id"])
		.where("claim_tokens.token_hash", "=", hashToken(rawToken))
		.where("claim_tokens.used_at", "is", null)
		.where("claim_tokens.expires_at", ">", new Date())
		.where("accounts.ghost", "=", true)
		.executeTakeFirst();
	return row ? { tokenId: row.id, accountId: row.account_id } : null;
}

/**
 * Atomically mark a claim token used and return its account id. The single
 * UPDATE ... WHERE used_at IS NULL is the concurrency guard: a token can only
 * be consumed once even under parallel claim attempts.
 */
export async function consumeClaimToken(
	db: Db,
	rawToken: string,
): Promise<string | null> {
	const row = await db
		.updateTable("claim_tokens")
		.set({ used_at: new Date() })
		.where("token_hash", "=", hashToken(rawToken))
		.where("used_at", "is", null)
		.where("expires_at", ">", new Date())
		.returning("account_id")
		.executeTakeFirst();
	return row?.account_id ?? null;
}
