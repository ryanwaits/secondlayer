import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { getDb, getSourceDb } from "@secondlayer/shared/db";
import { Hono } from "hono";
import { hashToken } from "../auth/keys.ts";
import { _resetRateLimitStoreForTests } from "../auth/rate-limit-store.ts";
import { errorHandler } from "../middleware/error.ts";
import {
	CHAIN_READ_NODE_TIMEOUT_MS,
	type ChainReadRouterOptions,
	createChainReadRouter,
	pruneChainReadCache,
} from "./chain-read.ts";

const HAS_DB = !!process.env.DATABASE_URL;

const ADDRESS = "SP000000000000000000002Q6VF78";
const CONTRACT_NAME = "token";
const NODE_URL = "http://node.test";
// `(ok u6)`.
const OK_SIX = "0x070100000000000000000000000000000006";
// `u1`, serialized: a valid one-arg call.
const ARG_U1 = "0x0100000000000000000000000000000001";

function randomTip(): string {
	return `0x${crypto.randomUUID().replace(/-/g, "").repeat(2)}`;
}

/** A node stub that records each call and answers with `answer`. */
function fakeNode(answer: () => Response | Promise<Response>) {
	const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
	const fetchImpl = (async (
		input: string | URL | Request,
		init?: RequestInit,
	) => {
		calls.push({
			url: String(input),
			body: JSON.parse(String(init?.body ?? "{}")),
		});
		return answer();
	}) as typeof fetch;
	return { calls, fetchImpl };
}

describe.skipIf(!HAS_DB)("POST /v1/chain-read/v2/contracts/call-read", () => {
	const db = HAS_DB ? getDb() : (null as never);
	const accountIds: string[] = [];
	const tips: string[] = [];
	let tenantKey: string;
	let accountKey: string;
	let prevMode: string | undefined;

	async function makeAccount(): Promise<string> {
		const row = await db
			.insertInto("accounts")
			.values({ email: null })
			.returning("id")
			.executeTakeFirstOrThrow();
		accountIds.push(row.id);
		return row.id;
	}

	async function makeKey(
		accountId: string,
		product: "tenant" | "account",
	): Promise<string> {
		const raw = `sk-sl_chain_read_test_${crypto.randomUUID()}`;
		await db
			.insertInto("api_keys")
			.values({
				key_hash: hashToken(raw),
				key_prefix: raw.slice(0, 14),
				account_id: accountId,
				ip_address: product === "tenant" ? "workload-host" : "test",
				product,
				tier: "free",
				status: "active",
			})
			.execute();
		return raw;
	}

	function appWith(opts: ChainReadRouterOptions): Hono {
		const app = new Hono();
		app.onError(errorHandler);
		app.route(
			"/v1/chain-read",
			createChainReadRouter({ nodeUrl: () => NODE_URL, ...opts }),
		);
		return app;
	}

	function read(
		app: Hono,
		opts: {
			key?: string;
			tip?: string | null;
			fn?: string;
			body?: unknown;
			rawBody?: string;
		} = {},
	): Promise<Response> {
		const tip = opts.tip === undefined ? randomTip() : opts.tip;
		if (tip) tips.push(tip);
		const fn = opts.fn ?? "get-decimals";
		const query = tip ? `?tip=${tip}` : "";
		return Promise.resolve(
			app.request(
				`/v1/chain-read/v2/contracts/call-read/${ADDRESS}/${CONTRACT_NAME}/${fn}${query}`,
				{
					method: "POST",
					headers: {
						"content-type": "application/json",
						...(opts.key === ""
							? {}
							: { authorization: `Bearer ${opts.key ?? tenantKey}` }),
					},
					body:
						opts.rawBody ??
						JSON.stringify(
							opts.body ?? { sender: ADDRESS, arguments: [ARG_U1] },
						),
				},
			),
		);
	}

	beforeAll(async () => {
		prevMode = process.env.INSTANCE_MODE;
		process.env.INSTANCE_MODE = "platform";
		const accountId = await makeAccount();
		tenantKey = await makeKey(accountId, "tenant");
		accountKey = await makeKey(accountId, "account");
	});

	beforeEach(async () => {
		await _resetRateLimitStoreForTests();
	});

	afterEach(async () => {
		if (tips.length > 0) {
			await getSourceDb()
				.deleteFrom("chain_read_cache")
				.where("index_block_hash", "in", tips.splice(0))
				.execute();
		}
	});

	afterAll(async () => {
		if (prevMode === undefined) delete process.env.INSTANCE_MODE;
		else process.env.INSTANCE_MODE = prevMode;
		if (accountIds.length > 0) {
			await db
				.deleteFrom("api_keys")
				.where("account_id", "in", accountIds)
				.execute();
			await db.deleteFrom("accounts").where("id", "in", accountIds).execute();
		}
	});

	test("a tenant key reads a contract pinned to a block and gets the node's result", async () => {
		const node = fakeNode(() => Response.json({ okay: true, result: OK_SIX }));
		const tip = randomTip();
		const res = await read(appWith({ fetchImpl: node.fetchImpl }), {
			tip,
			body: {
				sender: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
				arguments: [ARG_U1],
			},
		});

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ okay: true, result: OK_SIX });
		expect(node.calls).toHaveLength(1);
		expect(node.calls[0]?.url).toBe(
			`${NODE_URL}/v2/contracts/call-read/${ADDRESS}/${CONTRACT_NAME}/get-decimals?tip=${tip}`,
		);
		// The caller's sender is ignored: every read runs as the contract.
		expect(node.calls[0]?.body).toEqual({
			sender: ADDRESS,
			arguments: [ARG_U1],
		});
	});

	test("a customer account key is refused with CHAIN_READ_TENANT_ONLY", async () => {
		const node = fakeNode(() => Response.json({ okay: true, result: OK_SIX }));
		const res = await read(appWith({ fetchImpl: node.fetchImpl }), {
			key: accountKey,
		});
		expect(res.status).toBe(403);
		expect(((await res.json()) as { code: string }).code).toBe(
			"CHAIN_READ_TENANT_ONLY",
		);
		expect(node.calls).toHaveLength(0);
	});

	test("a read without a key is refused", async () => {
		const node = fakeNode(() => Response.json({ okay: true, result: OK_SIX }));
		const res = await read(appWith({ fetchImpl: node.fetchImpl }), {
			key: "",
		});
		expect(res.status).toBe(401);
		expect(node.calls).toHaveLength(0);
	});

	test("a read without a tip is refused with CHAIN_READ_UNPINNED", async () => {
		const node = fakeNode(() => Response.json({ okay: true, result: OK_SIX }));
		const app = appWith({ fetchImpl: node.fetchImpl });
		for (const tip of [null, "latest", "0xabc"]) {
			const res = await read(app, { tip });
			expect(res.status, String(tip)).toBe(400);
			expect(((await res.json()) as { code: string }).code).toBe(
				"CHAIN_READ_UNPINNED",
			);
		}
		expect(node.calls).toHaveLength(0);
	});

	test("the second identical pinned read is served from cache without calling the node", async () => {
		const node = fakeNode(() => Response.json({ okay: true, result: OK_SIX }));
		const app = appWith({ fetchImpl: node.fetchImpl });
		const tip = randomTip();

		const first = await read(app, { tip });
		// Same key, other sender and a 0x-less upper-case tip: the sender is
		// forced and the tip normalized, so both land on the same entry.
		const second = await read(app, {
			tip: tip.slice(2).toUpperCase(),
			body: {
				sender: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
				arguments: [ARG_U1],
			},
		});

		expect(await first.json()).toEqual({ okay: true, result: OK_SIX });
		expect(await second.json()).toEqual({ okay: true, result: OK_SIX });
		expect(node.calls).toHaveLength(1);
	});

	test("a node answer of okay false is returned verbatim and not cached", async () => {
		const answer = { okay: false, cause: "Unchecked(NoSuchContract)" };
		const node = fakeNode(() => Response.json(answer));
		const app = appWith({ fetchImpl: node.fetchImpl });
		const tip = randomTip();

		const first = await read(app, { tip });
		const second = await read(app, { tip });

		expect(first.status).toBe(200);
		expect(await first.json()).toEqual(answer);
		expect(await second.json()).toEqual(answer);
		expect(node.calls).toHaveLength(2);
	});

	test("a tenant over its rate limit gets 429 with Retry-After", async () => {
		const node = fakeNode(() => Response.json({ okay: true, result: OK_SIX }));
		const app = appWith({ fetchImpl: node.fetchImpl, readsPerMinute: 2 });

		expect((await read(app)).status).toBe(200);
		expect((await read(app)).status).toBe(200);
		const limited = await read(app);

		expect(limited.status).toBe(429);
		expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
		expect(((await limited.json()) as { code: string }).code).toBe(
			"CHAIN_READ_RATE_LIMITED",
		);
		expect(node.calls).toHaveLength(2);
	});

	test("a node that does not answer in 5 seconds returns CHAIN_READ_TIMEOUT", async () => {
		expect(CHAIN_READ_NODE_TIMEOUT_MS).toBe(5_000);
		const hanging = (async (
			_input: string | URL | Request,
			init?: RequestInit,
		) =>
			new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () =>
					reject(init.signal?.reason),
				);
			})) as typeof fetch;
		const res = await read(appWith({ fetchImpl: hanging, nodeTimeoutMs: 20 }));

		expect(res.status).toBe(504);
		expect(((await res.json()) as { code: string }).code).toBe(
			"CHAIN_READ_TIMEOUT",
		);
	});

	test("an oversized body or invalid function name is refused with 400", async () => {
		const node = fakeNode(() => Response.json({ okay: true, result: OK_SIX }));
		const app = appWith({ fetchImpl: node.fetchImpl });

		const cases: Array<Parameters<typeof read>[1]> = [
			{ rawBody: JSON.stringify({ arguments: ["0x".padEnd(17_000, "0")] }) },
			{ body: { arguments: Array.from({ length: 33 }, () => ARG_U1) } },
			{ body: { arguments: ["not-hex"] } },
			{ body: { arguments: "0x01" } },
			{ rawBody: "{" },
			{ fn: "get%2F..%2Fpox" },
			{ fn: "a".repeat(129) },
		];
		for (const c of cases) {
			const res = await read(app, c);
			expect(res.status, JSON.stringify(c).slice(0, 80)).toBe(400);
			expect(((await res.json()) as { code: string }).code).toBe(
				"CHAIN_READ_INVALID",
			);
		}
		expect(node.calls).toHaveLength(0);
	});

	test("the cache prune drops pinned entries older than 30 days and keeps the rest", async () => {
		const source = getSourceDb();
		await source.deleteFrom("chain_read_cache").execute();
		const day = 24 * 60 * 60 * 1000;
		const rows = [
			{ key: "old-pinned", tip: randomTip(), age: 31 * day },
			{ key: "old-constant", tip: null, age: 31 * day },
			{ key: "new-pinned", tip: randomTip(), age: 0 },
		];
		// Insertion order is id order, oldest first, as it is in production.
		for (const row of rows) {
			await source
				.insertInto("chain_read_cache")
				.values({
					contract_id: `${ADDRESS}.${row.key}`,
					function_name: "get-decimals",
					args_hash: "h",
					index_block_hash: row.tip,
					block_height: null,
					result_hex: OK_SIX,
					created_at: new Date(Date.now() - row.age),
				})
				.execute();
		}

		expect(await pruneChainReadCache(source)).toBe(1);
		const left = await source
			.selectFrom("chain_read_cache")
			.select("contract_id")
			.orderBy("id")
			.execute();
		expect(left.map((r) => r.contract_id)).toEqual([
			`${ADDRESS}.old-constant`,
			`${ADDRESS}.new-pinned`,
		]);
		await source.deleteFrom("chain_read_cache").execute();
	});
});
