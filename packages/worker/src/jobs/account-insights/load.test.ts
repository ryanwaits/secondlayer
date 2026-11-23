import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb } from "@secondlayer/shared/db";
import { groupRevokedCalls, loadAccountInput } from "./load.ts";

const at = (minute: number) => new Date(Date.UTC(2026, 9, 17, 20, minute));

function row(keyId: string, path: string, minute: number) {
	return {
		key_id: keyId,
		path,
		calls: 1,
		last_at: at(minute),
		name: keyId === "k1" ? "sharko-barko" : null,
		key_prefix: `sk-sl_${keyId}`,
		revoked_at: at(0),
	};
}

describe("groupRevokedCalls", () => {
	test("one entry per key, most-called first, with its top paths", () => {
		const out = groupRevokedCalls([
			row("k1", "/v1/index/transactions", 1),
			row("k1", "/v1/index/transactions", 5),
			row("k1", "/v1/streams/events", 3),
			row("k2", "/v1/index/blocks", 2),
		]);
		expect(out.map((k) => [k.keyId, k.calls])).toEqual([
			["k1", 3],
			["k2", 1],
		]);
		expect(out[0]?.lastAt).toEqual(at(5));
		expect(out[0]?.topPaths[0]).toEqual({
			path: "/v1/index/transactions",
			calls: 2,
		});
		expect(out[1]?.name).toBe("sk-sl_k2");
	});

	test("a login check with a revoked key is not the key being in use", () => {
		expect(groupRevokedCalls([row("k2", "/api/accounts/me", 59)])).toEqual([]);
		const out = groupRevokedCalls([
			row("k1", "/api/accounts/me", 59),
			row("k1", "/v1/index/ft-transfers", 41),
		]);
		expect(out.map((k) => [k.keyId, k.calls])).toEqual([["k1", 1]]);
	});

	test("sums per-path call counts from grouped rows", () => {
		const out = groupRevokedCalls([
			{ ...row("k1", "/v1/index/blocks", 7), calls: "40" },
			{ ...row("k1", "/v1/streams/events", 9), calls: 2 },
		]);
		expect(out[0]?.calls).toBe(42);
		expect(out[0]?.lastAt).toEqual(at(9));
		expect(out[0]?.topPaths).toEqual([
			{ path: "/v1/index/blocks", calls: 40 },
			{ path: "/v1/streams/events", calls: 2 },
		]);
	});
});

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB ? getDb() : (null as never);
const accountIds: string[] = [];

afterAll(async () => {
	if (!HAS_DB || accountIds.length === 0) return;
	await db
		.deleteFrom("api_failed_requests")
		.where("account_id", "in", accountIds)
		.execute();
	await db
		.deleteFrom("api_keys")
		.where("account_id", "in", accountIds)
		.execute();
	await db.deleteFrom("accounts").where("id", "in", accountIds).execute();
});

describe.skipIf(!HAS_DB)("loadAccountInput failed requests", () => {
	const now = new Date();
	const minutesAgo = (n: number) => new Date(now.getTime() - n * 60_000);

	async function makeAccount(): Promise<string> {
		const row = await db
			.insertInto("accounts")
			.values({ email: null, ghost: true })
			.returning("id")
			.executeTakeFirstOrThrow();
		accountIds.push(row.id);
		return row.id;
	}

	function failed(
		accountId: string,
		over: {
			path: string;
			status: number;
			created_at: Date;
			code?: string;
			api_key_id?: string;
		},
	) {
		return {
			request_id: `req_${randomUUID()}`,
			account_id: accountId,
			method: "GET",
			code: "UNAVAILABLE",
			query: {},
			...over,
		};
	}

	test("revoked-key calls are counted exactly past the row limit", async () => {
		const accountId = await makeAccount();
		const key = await db
			.insertInto("api_keys")
			.values({
				key_hash: randomUUID().replace(/-/g, ""),
				key_prefix: "sk-sl_load",
				name: "old-key",
				ip_address: "test",
				account_id: accountId,
				status: "revoked",
				revoked_at: minutesAgo(600),
				product: "account",
				tier: "free",
			})
			.returning("id")
			.executeTakeFirstOrThrow();
		const calls = [
			...[50, 40, 30, 20, 10].map((ago) => ["/v1/index/blocks", ago] as const),
			...[45, 5].map((ago) => ["/v1/streams/events", ago] as const),
			["/api/accounts/me", 1] as const,
		];
		await db
			.insertInto("api_failed_requests")
			.values(
				calls.map(([path, ago]) =>
					failed(accountId, {
						path,
						status: 401,
						code: "KEY_REVOKED",
						api_key_id: key.id,
						created_at: minutesAgo(ago),
					}),
				),
			)
			.execute();

		const input = await loadAccountInput(db, accountId, now, 50_000, 2);
		expect(input.revokedKeyCalls).toEqual([
			{
				keyId: key.id,
				name: "old-key",
				prefix: "sk-sl_load",
				revokedAt: minutesAgo(600),
				calls: 7,
				lastAt: minutesAgo(5),
				topPaths: [
					{ path: "/v1/index/blocks", calls: 5 },
					{ path: "/v1/streams/events", calls: 2 },
				],
			},
		]);
	});

	test("5xx and stack reads over the row limit keep the newest rows, oldest first", async () => {
		const accountId = await makeAccount();
		await db
			.insertInto("api_failed_requests")
			.values([
				...[50, 40, 30, 20, 10].map((ago) =>
					failed(accountId, {
						path: `/v1/index/${ago}`,
						status: 503,
						created_at: minutesAgo(ago),
					}),
				),
				...[45, 35, 25, 15].map((ago) =>
					failed(accountId, {
						path: `/api/subgraphs/${ago}`,
						status: 502,
						created_at: minutesAgo(ago),
					}),
				),
			])
			.execute();

		const input = await loadAccountInput(db, accountId, now, 50_000, 3);
		expect(input.failed5xx.map((f) => f.path)).toEqual([
			"/v1/index/20",
			"/api/subgraphs/15",
			"/v1/index/10",
		]);
		expect(input.stackFailures.map((f) => f.path)).toEqual([
			"/api/subgraphs/35",
			"/api/subgraphs/25",
			"/api/subgraphs/15",
		]);

		const all = await loadAccountInput(db, accountId, now);
		expect(all.failed5xx).toHaveLength(9);
		expect(all.stackFailures.map((f) => f.path)).toEqual([
			"/api/subgraphs/45",
			"/api/subgraphs/35",
			"/api/subgraphs/25",
			"/api/subgraphs/15",
		]);
	});
});
