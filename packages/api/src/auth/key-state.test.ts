import { afterAll, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { createApiApp } from "../create-app.ts";
import { isKeyLive, keyLiveness, liveKeyWhere } from "./key-state.ts";
import { generateApiKey } from "./keys.ts";

const NOW = new Date("2026-11-07T12:00:00Z");
const past = new Date(NOW.getTime() - 1000);
const future = new Date(NOW.getTime() + 1000);

describe("keyLiveness", () => {
	test("an active key with no expiry is live", () => {
		expect(keyLiveness({ status: "active", expires_at: null }, NOW)).toBe(
			"live",
		);
	});

	test("an active key before its expiry is live", () => {
		expect(isKeyLive({ status: "active", expires_at: future }, NOW)).toBe(true);
	});

	test("an active key at or past its expiry is expired", () => {
		expect(keyLiveness({ status: "active", expires_at: past }, NOW)).toBe(
			"expired",
		);
		expect(keyLiveness({ status: "active", expires_at: NOW }, NOW)).toBe(
			"expired",
		);
	});

	test("a revoked key is revoked even when it also expired", () => {
		expect(keyLiveness({ status: "revoked", expires_at: past }, NOW)).toBe(
			"revoked",
		);
		expect(isKeyLive({ status: "revoked", expires_at: null }, NOW)).toBe(false);
	});
});

describe.skipIf(!process.env.DATABASE_URL)("liveKeyWhere", () => {
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
			.values({ email: `key-state-${crypto.randomUUID()}@example.com` })
			.returning("id")
			.executeTakeFirstOrThrow();
		accountIds.push(account.id);
		return account.id;
	}

	async function insertKey(
		accountId: string,
		status: "active" | "revoked",
		expiresAt: Date | null,
	) {
		const { raw, hash, prefix } = generateApiKey();
		const row = await db
			.insertInto("api_keys")
			.values({
				key_hash: hash,
				key_prefix: prefix,
				ip_address: "test",
				account_id: accountId,
				status,
				revoked_at: status === "revoked" ? new Date() : null,
				product: "account",
				tier: "free",
				expires_at: expiresAt,
			})
			.returning(["id", "status", "expires_at"])
			.executeTakeFirstOrThrow();
		return { ...row, raw };
	}

	test("selects exactly the keys isKeyLive accepts", async () => {
		const accountId = await makeAccount();
		const keys = await Promise.all([
			insertKey(accountId, "active", null),
			insertKey(accountId, "active", new Date(Date.now() + 60_000)),
			insertKey(accountId, "active", new Date(Date.now() - 60_000)),
			insertKey(accountId, "revoked", null),
			insertKey(accountId, "revoked", new Date(Date.now() - 60_000)),
		]);
		const live = await db
			.selectFrom("api_keys")
			.select("id")
			.where("account_id", "=", accountId)
			.where(liveKeyWhere())
			.execute();
		const expected = keys.filter((k) => isKeyLive(k)).map((k) => k.id);
		expect(live.map((r) => r.id).sort()).toEqual(expected.sort());
		expect(expected).toHaveLength(2);
	});

	test("an expired key answers 401 KEY_EXPIRED, a revoked one KEY_REVOKED", async () => {
		const prev = process.env.INSTANCE_MODE;
		const prevDev = process.env.DEV_MODE;
		process.env.INSTANCE_MODE = "platform";
		process.env.DEV_MODE = "false";
		try {
			const app = createApiApp("platform");
			const accountId = await makeAccount();
			const expired = await insertKey(
				accountId,
				"active",
				new Date(Date.now() - 60_000),
			);
			const revoked = await insertKey(accountId, "revoked", null);
			const call = async (raw: string) => {
				const res = await app.request("/api/keys", {
					headers: { authorization: `Bearer ${raw}` },
				});
				return {
					status: res.status,
					code: ((await res.json()) as { code?: string }).code,
				};
			};
			expect(await call(expired.raw)).toEqual({
				status: 401,
				code: "KEY_EXPIRED",
			});
			expect(await call(revoked.raw)).toEqual({
				status: 401,
				code: "KEY_REVOKED",
			});
		} finally {
			if (prev === undefined)
				Reflect.deleteProperty(process.env, "INSTANCE_MODE");
			else process.env.INSTANCE_MODE = prev;
			if (prevDev === undefined)
				Reflect.deleteProperty(process.env, "DEV_MODE");
			else process.env.DEV_MODE = prevDev;
		}
	});
});
