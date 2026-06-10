import { afterAll, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { sweepGhostAccounts } from "./ghost-sweep.ts";

/**
 * Sweeper query against the real DB: only ghost accounts that are >30d old,
 * never claimed, and with no recently-used key get deleted (cascading their
 * api_keys + claim_tokens).
 */

const db = getDb();
const ids: string[] = [];

const DAY = 24 * 60 * 60 * 1000;
const now = new Date();
const oldDate = new Date(now.getTime() - 40 * DAY);

async function makeAccount(over: {
	ghost: boolean;
	createdAt: Date;
	email?: string | null;
}): Promise<string> {
	const row = await db
		.insertInto("accounts")
		.values({
			email: over.email ?? null,
			ghost: over.ghost,
			created_at: over.createdAt,
		})
		.returning("id")
		.executeTakeFirstOrThrow();
	ids.push(row.id);
	return row.id;
}

async function addKey(accountId: string, lastUsedAt: Date | null) {
	await db
		.insertInto("api_keys")
		.values({
			key_hash: `sweep-test-${crypto.randomUUID()}`,
			key_prefix: "sk-sl_sweep",
			account_id: accountId,
			ip_address: "test",
			product: "account",
			tier: "free",
			status: "active",
			last_used_at: lastUsedAt,
		})
		.execute();
}

async function addClaimToken(accountId: string, usedAt: Date | null) {
	await db
		.insertInto("claim_tokens")
		.values({
			account_id: accountId,
			token_hash: `sweep-test-${crypto.randomUUID()}`,
			expires_at: new Date(now.getTime() + 30 * DAY),
			used_at: usedAt,
		})
		.execute();
}

afterAll(async () => {
	if (ids.length > 0) {
		await db.deleteFrom("accounts").where("id", "in", ids).execute();
	}
});

describe("sweepGhostAccounts", () => {
	test("sweeps only expired, unclaimed, unused ghosts", async () => {
		// Should be swept: old ghost, unused key, unused token.
		const sweepable = await makeAccount({ ghost: true, createdAt: oldDate });
		await addKey(sweepable, null);
		await addClaimToken(sweepable, null);

		// Kept: old ghost but key used recently.
		const activeKey = await makeAccount({ ghost: true, createdAt: oldDate });
		await addKey(activeKey, new Date(now.getTime() - 1 * DAY));

		// Kept: old ghost but a claim token was used.
		const claimed = await makeAccount({ ghost: true, createdAt: oldDate });
		await addClaimToken(claimed, new Date(now.getTime() - 5 * DAY));

		// Kept: fresh ghost.
		const fresh = await makeAccount({ ghost: true, createdAt: now });

		// Kept: old NON-ghost account.
		const real = await makeAccount({
			ghost: false,
			createdAt: oldDate,
			email: `sweep-real-${crypto.randomUUID().slice(0, 8)}@example.com`,
		});

		const deleted = await sweepGhostAccounts(db, now);

		expect(deleted).toContain(sweepable);
		expect(deleted).not.toContain(activeKey);
		expect(deleted).not.toContain(claimed);
		expect(deleted).not.toContain(fresh);
		expect(deleted).not.toContain(real);

		// Cascade: the swept ghost's children are gone.
		const orphanKeys = await db
			.selectFrom("api_keys")
			.select("id")
			.where("account_id", "=", sweepable)
			.execute();
		expect(orphanKeys).toHaveLength(0);
		const orphanTokens = await db
			.selectFrom("claim_tokens")
			.select("id")
			.where("account_id", "=", sweepable)
			.execute();
		expect(orphanTokens).toHaveLength(0);

		// Old key with stale last_used_at (>30d) does not protect the ghost.
		const staleUse = await makeAccount({ ghost: true, createdAt: oldDate });
		await addKey(staleUse, new Date(now.getTime() - 35 * DAY));
		const deleted2 = await sweepGhostAccounts(db, now);
		expect(deleted2).toContain(staleUse);
	});
});
