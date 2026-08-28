import { beforeEach, describe, expect, test } from "bun:test";
import { getSourceDb, sql } from "@secondlayer/shared/db";
import { ChainReadError, createChainReadClient } from "./chain-read.ts";

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
