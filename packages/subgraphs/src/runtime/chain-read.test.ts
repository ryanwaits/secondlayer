import { beforeEach, describe, expect, test } from "bun:test";
import { chainReadArgsHash } from "@secondlayer/shared/chain-read";
import { getSourceDb, sql } from "@secondlayer/shared/db";
import { ChainReadError, createChainReadClient } from "./chain-read.ts";
import { HandlerReadError } from "./realm.ts";

const HAS_DB = !!process.env.DATABASE_URL;

const TOKEN_ABI = {
	functions: [
		{
			name: "get-decimals",
			access: "read-only",
			args: [],
			outputs: { response: { ok: "uint128", error: "uint128" } },
		},
		{
			name: "get-balance",
			access: "read-only",
			args: [{ name: "who", type: "principal" }],
			outputs: { response: { ok: "uint128", error: "uint128" } },
		},
		{
			name: "transfer",
			access: "public",
			args: [],
			outputs: { response: { ok: "bool", error: "uint128" } },
		},
	],
	variables: [],
	maps: [],
	fungible_tokens: [],
	non_fungible_tokens: [],
} as const;

const CONTRACT = "SP000000000000000000002Q6VF78.token";
const IBH = "0xaaaa";

/** A node that answers `(ok u6)` and counts how many times it was asked. */
function fakeNode(responseHex: string) {
	let calls = 0;
	const tips: Array<string | null> = [];
	const server = Bun.serve({
		port: 0,
		fetch(req) {
			calls++;
			tips.push(new URL(req.url).searchParams.get("tip"));
			return Response.json({ okay: true, result: responseHex });
		},
	});
	return {
		url: `http://localhost:${server.port}`,
		get calls() {
			return calls;
		},
		get tips() {
			return tips;
		},
		stop: () => server.stop(true),
	};
}

// `(ok u6)` — response-ok wrapping a uint128 of 6.
const OK_SIX = "0x070100000000000000000000000000000006";

describe("createChainReadClient — pinning", () => {
	test("refuses to read when the block has no index_block_hash", async () => {
		const client = createChainReadClient({
			blockHeight: 42,
			indexBlockHash: null,
			rpcUrl: "http://localhost:1",
		});

		// Reading at the node's tip instead would make the same reindex produce
		// different rows — the exact corruption this guards.
		await expect(
			client.contract(CONTRACT, TOKEN_ABI).read.getDecimals({}),
		).rejects.toThrow(/no index_block_hash/);
	});

	test("allows omitting the args object on no-arg reads", async () => {
		const client = createChainReadClient({
			blockHeight: 42,
			indexBlockHash: null,
			rpcUrl: "http://localhost:1",
		});

		await expect(
			client.contract(CONTRACT, TOKEN_ABI).read.getDecimals(),
		).rejects.toThrow(/no index_block_hash/);
	});

	test("refuses a function the ABI marks public", async () => {
		const client = createChainReadClient({
			blockHeight: 42,
			indexBlockHash: IBH,
			rpcUrl: "http://localhost:1",
		});

		const token = client.contract(CONTRACT, TOKEN_ABI);
		// `transfer` is public, so it is not on `read` at all — reach past the
		// type and the runtime still refuses.
		await expect(
			(
				token.read as unknown as Record<string, () => Promise<unknown>>
			).transfer(),
		).rejects.toThrow(ChainReadError);
	});

	test("names the env var when no node is configured", async () => {
		const client = createChainReadClient({
			blockHeight: 42,
			indexBlockHash: IBH,
			rpcUrl: "",
		});
		const saved = process.env.STACKS_NODE_RPC_URL;
		// Empty is the same falsy "not configured" the resolver sees when unset.
		process.env.STACKS_NODE_RPC_URL = "";
		try {
			await expect(
				client.contract(CONTRACT, TOKEN_ABI).read.getDecimals({}),
			).rejects.toThrow(/STACKS_NODE_RPC_URL/);
		} finally {
			process.env.STACKS_NODE_RPC_URL = saved ?? "";
		}
	});
});

/**
 * A hosted proxy stub: records each call and answers with `answer(tip)`.
 * Stands in for app-server's `/v1/chain-read` route.
 */
function fakeHostedApi(
	answer: (tip: string | null) => { status: number; body: unknown },
) {
	const calls: Array<{
		path: string;
		tip: string | null;
		authorization: string | null;
		args: string[];
	}> = [];
	const server = Bun.serve({
		port: 0,
		async fetch(req) {
			const url = new URL(req.url);
			const tip = url.searchParams.get("tip");
			const body = (await req.json()) as { arguments: string[] };
			calls.push({
				path: url.pathname,
				tip,
				authorization: req.headers.get("authorization"),
				args: body.arguments,
			});
			const { status, body: out } = answer(tip);
			return Response.json(out, { status });
		},
	});
	return {
		url: `http://localhost:${server.port}`,
		calls,
		stop: () => server.stop(true),
	};
}

const TENANT_KEY = "sk-sl_hosted_tenant_read_test";

/** Run `fn` as a hosted tenant: no node, chain data from `apiUrl`, and an
 *  `index_progress` with no row for the network (one no test ever writes). */
async function asHostedTenant<T>(
	apiUrl: string,
	fn: () => Promise<T>,
): Promise<T> {
	const keys = [
		"STACKS_NODE_RPC_URL",
		"SUBGRAPH_INDEX_API_URL",
		"NETWORK",
		"INDEX_INTERNAL_API_KEY",
	] as const;
	const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
	process.env.STACKS_NODE_RPC_URL = "";
	process.env.SUBGRAPH_INDEX_API_URL = apiUrl;
	process.env.NETWORK = "hosted-tenant-test";
	process.env.INDEX_INTERNAL_API_KEY = TENANT_KEY;
	try {
		return await fn();
	} finally {
		for (const k of keys) {
			const value = saved[k];
			if (value === undefined) delete process.env[k];
			else process.env[k] = value;
		}
	}
}

describe.skipIf(!HAS_DB)("createChainReadClient — hosted tenant", () => {
	const db = HAS_DB ? getSourceDb() : (null as never);

	beforeEach(async () => {
		await sql`DELETE FROM chain_read_cache`.execute(db);
	});

	const ok = () => ({ status: 200, body: { okay: true, result: OK_SIX } });

	test("a hosted tenant read goes through the hosted chain-read path with the tenant key", async () => {
		const api = fakeHostedApi(ok);
		try {
			const value = await asHostedTenant(api.url, () =>
				createChainReadClient({ blockHeight: 42, indexBlockHash: IBH, db })
					.contract(CONTRACT, TOKEN_ABI)
					.read.getDecimals(),
			);
			expect(value).toBe(6n);
			expect(api.calls).toHaveLength(1);
			expect(api.calls[0]?.path).toBe(
				"/v1/chain-read/v2/contracts/call-read/SP000000000000000000002Q6VF78/token/get-decimals",
			);
			expect(api.calls[0]?.tip).toBe(IBH);
			expect(api.calls[0]?.authorization).toBe(`Bearer ${TENANT_KEY}`);
		} finally {
			api.stop();
		}
	});

	test("an explicit node URL wins over the hosted path", async () => {
		const api = fakeHostedApi(ok);
		const node = fakeNode(OK_SIX);
		try {
			await asHostedTenant(api.url, () =>
				createChainReadClient({
					blockHeight: 42,
					indexBlockHash: IBH,
					rpcUrl: node.url,
					db,
				})
					.contract(CONTRACT, TOKEN_ABI)
					.read.getDecimals(),
			);
			expect(node.calls).toBe(1);
			expect(api.calls).toHaveLength(0);
		} finally {
			api.stop();
			node.stop();
		}
	});

	test("a contract-constant read on an unpinned block fails the block on a hosted tenant", async () => {
		const api = fakeHostedApi(ok);
		try {
			const read = asHostedTenant(api.url, () =>
				createChainReadClient({ blockHeight: 42, indexBlockHash: null, db })
					.contract(CONTRACT, TOKEN_ABI, { cache: "contract-constant" })
					.read.getDecimals(),
			);
			await expect(read).rejects.toBeInstanceOf(HandlerReadError);
			expect(api.calls).toHaveLength(0);
		} finally {
			api.stop();
		}
	});

	test("server and client compute the same args hash", async () => {
		const api = fakeHostedApi(ok);
		try {
			await asHostedTenant(api.url, () =>
				createChainReadClient({ blockHeight: 42, indexBlockHash: IBH, db })
					.contract(CONTRACT, TOKEN_ABI)
					.read.getBalance({
						who: "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE",
					}),
			);
			const row = await db
				.selectFrom("chain_read_cache")
				.select("args_hash")
				.where("index_block_hash", "=", IBH)
				.executeTakeFirstOrThrow();
			// The server hashes the hex it receives on the wire; the client
			// hashes the Clarity values it serialized. Same key either way.
			expect(row.args_hash).toBe(chainReadArgsHash(api.calls[0]?.args ?? []));
		} finally {
			api.stop();
		}
	});

	test("a proxy refusal of a customer key says to set STACKS_NODE_RPC_URL", async () => {
		const api = fakeHostedApi(() => ({
			status: 403,
			body: { error: "tenant only", code: "CHAIN_READ_TENANT_ONLY" },
		}));
		try {
			const read = asHostedTenant(api.url, () =>
				createChainReadClient({ blockHeight: 42, indexBlockHash: IBH, db })
					.contract(CONTRACT, TOKEN_ABI)
					.read.getDecimals(),
			);
			await expect(read).rejects.toBeInstanceOf(HandlerReadError);
			await expect(read).rejects.toThrow(/STACKS_NODE_RPC_URL/);
		} finally {
			api.stop();
		}
	});

	test("a proxy 400 is the handler's mistake and fails only the event", async () => {
		const api = fakeHostedApi(() => ({
			status: 400,
			body: { error: "too many args", code: "CHAIN_READ_INVALID" },
		}));
		try {
			const read = asHostedTenant(api.url, () =>
				createChainReadClient({ blockHeight: 42, indexBlockHash: IBH, db })
					.contract(CONTRACT, TOKEN_ABI)
					.read.getDecimals(),
			);
			await expect(read).rejects.toBeInstanceOf(ChainReadError);
			expect(api.calls).toHaveLength(1);
		} finally {
			api.stop();
		}
	});
});

describe.skipIf(!HAS_DB)("createChainReadClient — cache", () => {
	const db = HAS_DB ? getSourceDb() : null;

	beforeEach(async () => {
		if (!db) return;
		await sql`DELETE FROM chain_read_cache`.execute(db);
	});

	test("hits the node once per block and pins the tip", async () => {
		if (!db) throw new Error("missing db");
		const node = fakeNode(OK_SIX);
		try {
			const client = createChainReadClient({
				blockHeight: 100,
				indexBlockHash: IBH,
				rpcUrl: node.url,
				db,
			});

			const token = client.contract(CONTRACT, TOKEN_ABI);
			const first = await token.read.getDecimals({});
			const second = await token.read.getDecimals({});

			// Response is unwrapped out of `(ok …)`, same as getContract's reads.
			expect(first).toBe(6n);
			expect(second).toBe(6n);
			expect(node.calls).toBe(1);
			expect(node.tips).toEqual([IBH]);
		} finally {
			node.stop();
		}
	});

	test("a different block is a different key", async () => {
		if (!db) throw new Error("missing db");
		const node = fakeNode(OK_SIX);
		try {
			for (const [height, ibh] of [
				[100, "0xaaaa"],
				[101, "0xbbbb"],
			] as const) {
				await createChainReadClient({
					blockHeight: height,
					indexBlockHash: ibh,
					rpcUrl: node.url,
					db,
				})
					.contract(CONTRACT, TOKEN_ABI)
					.read.getDecimals({});
			}
			expect(node.calls).toBe(2);
			expect(node.tips).toEqual(["0xaaaa", "0xbbbb"]);
		} finally {
			node.stop();
		}
	});

	test("contract-constant resolves once across blocks", async () => {
		if (!db) throw new Error("missing db");
		const node = fakeNode(OK_SIX);
		try {
			for (const [height, ibh] of [
				[100, "0xaaaa"],
				[101, "0xbbbb"],
			] as const) {
				await createChainReadClient({
					blockHeight: height,
					indexBlockHash: ibh,
					rpcUrl: node.url,
					db,
				})
					.contract(CONTRACT, TOKEN_ABI, { cache: "contract-constant" })
					.read.getDecimals({});
			}
			// This is what makes a backfill affordable: per-block keying would
			// mean one RPC per block forever.
			expect(node.calls).toBe(1);
		} finally {
			node.stop();
		}
	});

	test("different args are different entries", async () => {
		if (!db) throw new Error("missing db");
		const node = fakeNode(OK_SIX);
		try {
			const client = createChainReadClient({
				blockHeight: 100,
				indexBlockHash: IBH,
				rpcUrl: node.url,
				db,
			});
			const token = client.contract(CONTRACT, TOKEN_ABI);
			await token.read.getBalance({
				who: "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE",
			});
			await token.read.getBalance({
				who: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
			});
			expect(node.calls).toBe(2);
		} finally {
			node.stop();
		}
	});

	test("a reorg-replaced block does not inherit the orphaned answer", async () => {
		if (!db) throw new Error("missing db");
		const orphaned = fakeNode(OK_SIX);
		let replacement: ReturnType<typeof fakeNode> | null = null;
		try {
			await createChainReadClient({
				blockHeight: 100,
				indexBlockHash: "0xorphan",
				rpcUrl: orphaned.url,
				db,
			})
				.contract(CONTRACT, TOKEN_ABI)
				.read.getDecimals({});

			// Same height, new block id → the cache must miss and re-read.
			replacement = fakeNode("0x070100000000000000000000000000000008");
			const value = await createChainReadClient({
				blockHeight: 100,
				indexBlockHash: "0xcanonical",
				rpcUrl: replacement.url,
				db,
			})
				.contract(CONTRACT, TOKEN_ABI)
				.read.getDecimals({});

			expect(value).toBe(8n);
			expect(replacement.calls).toBe(1);
		} finally {
			orphaned.stop();
			replacement?.stop();
		}
	});
});
