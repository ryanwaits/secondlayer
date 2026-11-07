import { afterAll, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { sql } from "kysely";
import { purgeExpiredGhostAccounts } from "./ghost-accounts-purge.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB ? getDb() : (null as never);
const ids: string[] = [];
const DAY_MS = 24 * 60 * 60 * 1000;

afterAll(async () => {
	if (!HAS_DB || ids.length === 0) return;
	await db.deleteFrom("accounts").where("id", "in", ids).execute();
});

function keyRow(accountId: string, expiresAt: Date | null) {
	return {
		key_hash: `ghost-purge-${crypto.randomUUID()}`,
		key_prefix: "sk-sl_ghostpg",
		account_id: accountId,
		ip_address: "test",
		product: expiresAt ? ("docs" as const) : ("account" as const),
		tier: "free" as const,
		status: "active" as const,
		expires_at: expiresAt,
	};
}

/** An account whose one docs key expired `expiredDaysAgo` days ago, with a ledger row. */
async function accountWithExpiredKey(ghost: boolean, expiredDaysAgo: number) {
	const account = await db
		.insertInto("accounts")
		.values({
			ghost,
			email: ghost ? null : `ghost-purge-${crypto.randomUUID()}@example.com`,
		})
		.returning("id")
		.executeTakeFirstOrThrow();
	ids.push(account.id);
	const key = await db
		.insertInto("api_keys")
		.values(keyRow(account.id, new Date(Date.now() - expiredDaysAgo * DAY_MS)))
		.returning("id")
		.executeTakeFirstOrThrow();
	await db
		.insertInto("usage_ledger")
		.values({
			account_id: account.id,
			unit: "rows.delivered",
			quantity: 10,
			usd_micros: 0,
			source: "test",
			api_key_id: key.id,
			observed_quantity: null,
			idempotency_key: crypto.randomUUID(),
		})
		.execute();
	return account.id;
}

async function count(
	table: "accounts" | "api_keys" | "usage_ledger",
	accountId: string,
): Promise<number> {
	const row = await db
		.selectFrom(table)
		.select((eb) => eb.fn.countAll<string>().as("n"))
		.where(table === "accounts" ? "id" : "account_id", "=", accountId)
		.executeTakeFirstOrThrow();
	return Number(row.n);
}

describe.skipIf(!HAS_DB)("purgeExpiredGhostAccounts", () => {
	test("deletes a ghost whose key expired 8 days ago, with its keys and ledger rows", async () => {
		const id = await accountWithExpiredKey(true, 8);
		await purgeExpiredGhostAccounts();
		expect(await count("accounts", id)).toBe(0);
		expect(await count("api_keys", id)).toBe(0);
		expect(await count("usage_ledger", id)).toBe(0);
	});

	test("keeps a ghost whose key expired 6 days ago", async () => {
		const id = await accountWithExpiredKey(true, 6);
		await purgeExpiredGhostAccounts();
		expect(await count("accounts", id)).toBe(1);
		expect(await count("api_keys", id)).toBe(1);
	});

	test("never touches an account that is not a ghost", async () => {
		const id = await accountWithExpiredKey(false, 30);
		await purgeExpiredGhostAccounts();
		expect(await count("accounts", id)).toBe(1);
		expect(await count("api_keys", id)).toBe(1);
	});

	/** A ghost with no keys at all, created `createdDaysAgo` days ago. */
	async function keylessGhost(createdDaysAgo: number) {
		const account = await db
			.insertInto("accounts")
			.values({
				ghost: true,
				email: null,
				created_at: new Date(Date.now() - createdDaysAgo * DAY_MS),
			})
			.returning("id")
			.executeTakeFirstOrThrow();
		ids.push(account.id);
		return account.id;
	}

	test("deletes a keyless ghost created 9 days ago", async () => {
		const id = await keylessGhost(9);
		await purgeExpiredGhostAccounts();
		expect(await count("accounts", id)).toBe(0);
	});

	test("keeps a keyless ghost created 7 days ago", async () => {
		const id = await keylessGhost(7);
		await purgeExpiredGhostAccounts();
		expect(await count("accounts", id)).toBe(1);
	});

	test("a row that refuses deletion is skipped and the rest of the purge goes on", async () => {
		const blocked = await accountWithExpiredKey(true, 9);
		const before = await accountWithExpiredKey(true, 9);
		const after = await accountWithExpiredKey(true, 9);
		await sql`
			CREATE TABLE ghost_purge_blocker (
				account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT
			)
		`.execute(db);
		try {
			await sql`INSERT INTO ghost_purge_blocker VALUES (${blocked})`.execute(
				db,
			);
			await purgeExpiredGhostAccounts();
			expect(await count("accounts", blocked)).toBe(1);
			expect(await count("accounts", before)).toBe(0);
			expect(await count("accounts", after)).toBe(0);
		} finally {
			await sql`DROP TABLE ghost_purge_blocker`.execute(db);
		}
	});

	test("purges more than one batch of due ghosts", async () => {
		const rows = Array.from({ length: 520 }, () => ({
			ghost: true,
			email: null,
			created_at: new Date(Date.now() - 9 * DAY_MS),
		}));
		const inserted = await db
			.insertInto("accounts")
			.values(rows)
			.returning("id")
			.execute();
		const all = inserted.map((r) => r.id);
		ids.push(...all);
		await purgeExpiredGhostAccounts();
		const left = await db
			.selectFrom("accounts")
			.select("id")
			.where("id", "in", all)
			.execute();
		expect(left).toEqual([]);
	});

	test("keeps a ghost that also holds a key with no expiry", async () => {
		const id = await accountWithExpiredKey(true, 8);
		await db.insertInto("api_keys").values(keyRow(id, null)).execute();
		await purgeExpiredGhostAccounts();
		expect(await count("accounts", id)).toBe(1);
	});
});
