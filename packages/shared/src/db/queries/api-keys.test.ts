import { afterAll, describe, expect, test } from "bun:test";
import { getDb } from "../index.ts";
import { apiKeyMachine, liveKeyWhere, revokeApiKey } from "./api-keys.ts";

describe("apiKeyMachine", () => {
	test("allows active to revoked and refuses revoked to active", () => {
		expect(apiKeyMachine.canTransition("active", "revoked")).toBe(true);
		expect(apiKeyMachine.canTransition("revoked", "active")).toBe(false);
	});
});

describe.skipIf(!process.env.DATABASE_URL)("api key revocation", () => {
	const db = getDb();
	const accountIds: string[] = [];

	afterAll(async () => {
		for (const id of accountIds) {
			await db.deleteFrom("accounts").where("id", "=", id).execute();
		}
	});

	async function makeAccount() {
		const account = await db
			.insertInto("accounts")
			.values({ email: `api-keys-${crypto.randomUUID()}@example.com` })
			.returning("id")
			.executeTakeFirstOrThrow();
		accountIds.push(account.id);
		return account.id;
	}

	async function insertKey(
		accountId: string,
		status: "active" | "revoked",
		opts: { expiresAt?: Date | null; revokedAt?: Date | null } = {},
	) {
		return db
			.insertInto("api_keys")
			.values({
				key_hash: crypto.randomUUID().replaceAll("-", ""),
				key_prefix: "sk-sl_test",
				ip_address: "test",
				account_id: accountId,
				status,
				revoked_at: opts.revokedAt ?? null,
				product: "account",
				tier: "free",
				expires_at: opts.expiresAt ?? null,
			})
			.returning("id")
			.executeTakeFirstOrThrow();
	}

	const readKey = (id: string) =>
		db
			.selectFrom("api_keys")
			.select(["status", "revoked_at"])
			.where("id", "=", id)
			.executeTakeFirstOrThrow();

	test("revokes an active key and stamps revoked_at", async () => {
		const accountId = await makeAccount();
		const key = await insertKey(accountId, "active");
		expect(await revokeApiKey(db, key.id)).toEqual({ id: key.id });
		const row = await readKey(key.id);
		expect(row.status).toBe("revoked");
		expect(row.revoked_at).not.toBeNull();
	});

	test("an already revoked key returns null and keeps its first revoked_at", async () => {
		const accountId = await makeAccount();
		const first = new Date("2026-01-01T00:00:00Z");
		const key = await insertKey(accountId, "revoked", { revokedAt: first });
		expect(await revokeApiKey(db, key.id)).toBeNull();
		const row = await readKey(key.id);
		expect(row.revoked_at?.getTime()).toBe(first.getTime());
	});

	test("liveKeyWhere skips an active key whose expires_at has passed", async () => {
		const accountId = await makeAccount();
		const now = new Date();
		const live = await insertKey(accountId, "active", {
			expiresAt: new Date(now.getTime() + 60_000),
		});
		await insertKey(accountId, "active", {
			expiresAt: new Date(now.getTime() - 60_000),
		});
		const rows = await db
			.selectFrom("api_keys")
			.select("id")
			.where("account_id", "=", accountId)
			.where(liveKeyWhere(now))
			.execute();
		expect(rows.map((r) => r.id)).toEqual([live.id]);
	});
});
