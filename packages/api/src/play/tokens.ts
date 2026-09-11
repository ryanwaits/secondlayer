import type { Database } from "@secondlayer/shared/db";
import type { Kysely } from "kysely";
import { hashToken } from "../auth/keys.ts";

/** Play subgraph and claim-token lifetime. */
export const CLAIM_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function generateClaimToken(): { raw: string; hash: string } {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	const raw = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
		"",
	);
	return { raw, hash: hashToken(raw) };
}

export async function createClaimToken(
	db: Kysely<Database>,
	accountId: string,
): Promise<{ raw: string; expiresAt: Date }> {
	const { raw, hash } = generateClaimToken();
	const expiresAt = new Date(Date.now() + CLAIM_TOKEN_TTL_MS);
	await db
		.insertInto("claim_tokens")
		.values({
			account_id: accountId,
			token_hash: hash,
			expires_at: expiresAt,
		})
		.execute();
	return { raw, expiresAt };
}

/** Unused, unexpired token row. Does not consume. */
export async function findUnusedClaimToken(
	db: Kysely<Database>,
	tokenHash: string,
	now = new Date(),
): Promise<{ account_id: string; expires_at: Date } | null> {
	const row = await db
		.selectFrom("claim_tokens")
		.select(["account_id", "expires_at"])
		.where("token_hash", "=", tokenHash)
		.where("used_at", "is", null)
		.where("expires_at", ">", now)
		.executeTakeFirst();
	return row ?? null;
}

/** One-shot consume. Returns the ghost account_id, or null if used/expired. */
export async function consumeClaimToken(
	db: Kysely<Database>,
	tokenHash: string,
	now = new Date(),
): Promise<string | null> {
	const row = await db
		.updateTable("claim_tokens")
		.set({ used_at: now })
		.where("token_hash", "=", tokenHash)
		.where("used_at", "is", null)
		.where("expires_at", ">", now)
		.returning("account_id")
		.executeTakeFirst();
	return row?.account_id ?? null;
}
