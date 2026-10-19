import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import {
	type ParsedTx,
	parseBlock,
	parseTransaction,
} from "@secondlayer/bitcoin/block";
import { Hono } from "hono";
import { _resetRateLimitStoreForTests } from "../auth/rate-limit-store.ts";
import type { OutspendOptions } from "../bitcoin/outspend.ts";
import { MUTABLE_CACHE_CONTROL } from "../http/cache.ts";
import { INDEX_READ_SCOPE, type IndexTokenStore } from "../index/auth.ts";
import { errorHandler } from "../middleware/error.ts";
import {
	type BitcoinRouterOptions,
	OUTSPEND_RATE_LIMIT,
	createBitcoinRouter,
} from "./bitcoin.ts";

// ── A fake bitcoind over real raw blocks ─────────────────────────────────

const le32 = (n: number) => {
	const b = Buffer.alloc(4);
	b.writeUInt32LE(n >>> 0);
	return b.toString("hex");
};
const reverseHex = (hex: string) =>
	Buffer.from(hex, "hex").reverse().toString("hex");

const P2WPKH = `0014${"ab".repeat(20)}`;
const OP_RETURN = "6a04deadbeef";

type Outpoint = { txid: string; vout: number };

let txTag = 0;
/** A legacy-serialized tx; the locktime tag keeps every txid distinct. */
function rawTx(inputs: Outpoint[], scripts: string[] = [P2WPKH]): string {
	const ins = inputs
		.map((i) => `${reverseHex(i.txid)}${le32(i.vout)}00ffffffff`)
		.join("");
	const outs = scripts
		.map(
			(s) =>
				`e803000000000000${(s.length / 2).toString(16).padStart(2, "0")}${s}`,
		)
		.join("");
	return `02000000${inputs.length.toString(16).padStart(2, "0")}${ins}${scripts.length.toString(16).padStart(2, "0")}${outs}${le32(++txTag)}`;
}

const COINBASE_IN = { txid: "00".repeat(32), vout: 0xffffffff };

const BASE = 900_000;

class FakeBitcoind {
	blocks: Array<{
		hash: string;
		hex: string;
		txs: ParsedTx[];
		hexes: string[];
	}> = [];
	mempool: Array<{ tx: ParsedTx; hex: string }> = [];
	getblockCalls = 0;
	/** When set, `getblock` waits on it (to hold a block read in flight). */
	gate: Promise<void> | null = null;
	hasSpendingPrevout = true;

	get tipHeight() {
		return BASE + this.blocks.length - 1;
	}

	/** Mine the mempool plus `txHexes` into a new tip block. */
	mine(txHexes: string[] = []): string {
		const prev = this.blocks.at(-1)?.hash ?? "00".repeat(32);
		const hexes = [
			rawTx([COINBASE_IN]),
			...this.mempool.map((m) => m.hex),
			...txHexes,
		];
		const header = `00000020${reverseHex(prev)}${"00".repeat(32)}${le32(1_700_000_000 + this.blocks.length)}ffff001d${le32(this.blocks.length)}`;
		const hex = `${header}${hexes.length.toString(16).padStart(2, "0")}${hexes.join("")}`;
		const block = parseBlock(hex);
		this.blocks.push({ hash: block.hash, hex, txs: block.txs, hexes });
		this.mempool = [];
		return block.hash;
	}

	/** Mine `n` blocks with nothing but a coinbase. */
	mineEmpty(n: number) {
		for (let i = 0; i < n; i++) this.mine();
	}

	broadcast(hex: string): string {
		const tx = parseTransaction(hex);
		this.mempool.push({ tx, hex });
		return tx.txid;
	}

	/** Drop the tip block; its non-coinbase txs go back to the mempool. */
	disconnectTip() {
		const block = this.blocks.pop();
		if (!block) return;
		block.txs.slice(1).forEach((tx, i) => {
			this.mempool.push({ tx, hex: block.hexes[i + 1] as string });
		});
	}

	private get mempoolTxs() {
		return this.mempool.map((m) => m.tx);
	}

	private find(txid: string) {
		for (const [i, block] of this.blocks.entries()) {
			const tx = block.txs.find((t) => t.txid === txid);
			if (tx) return { tx, height: BASE + i, hash: block.hash };
		}
		const tx = this.mempoolTxs.find((t) => t.txid === txid);
		return tx ? { tx, height: null, hash: null } : null;
	}

	private spender(pool: ParsedTx[], txid: string, vout: number) {
		return pool.find((t) =>
			t.inputs.some((i) => i.prevTxid === txid && i.prevVout === vout),
		);
	}

	private chainTxs() {
		return this.blocks.flatMap((b) => b.txs);
	}

	async handle(method: string, params: unknown[]): Promise<Response> {
		const reply = (result: unknown) =>
			Response.json({ result, error: null, id: "x" });
		const fail = (code: number, message: string) =>
			Response.json(
				{ result: null, error: { code, message }, id: "x" },
				{ status: 500 },
			);
		switch (method) {
			case "getrawtransaction": {
				const found = this.find(params[0] as string);
				if (!found)
					return fail(-5, "No such mempool or blockchain transaction");
				return reply({
					txid: found.tx.txid,
					...(found.hash
						? {
								blockhash: found.hash,
								confirmations: this.tipHeight - (found.height as number) + 1,
							}
						: {}),
					vin: found.tx.inputs.map((i) => ({
						txid: i.prevTxid,
						vout: i.prevVout,
					})),
					vout: found.tx.outputs.map((o, n) => ({
						n,
						scriptPubKey: { hex: Buffer.from(o.script).toString("hex") },
					})),
				});
			}
			case "gettxout": {
				const [txid, n, includeMempool] = params as [string, number, boolean];
				const found = this.find(txid);
				const output = found?.tx.outputs[n];
				const visible = found && (found.hash || includeMempool);
				const spent =
					this.spender(this.chainTxs(), txid, n) ||
					(includeMempool && this.spender(this.mempoolTxs, txid, n));
				const unspendable = output?.script[0] === 0x6a;
				return reply(
					visible && output && !spent && !unspendable
						? { bestblock: this.blocks.at(-1)?.hash, value: 0.00001 }
						: null,
				);
			}
			case "gettxspendingprevout": {
				if (!this.hasSpendingPrevout) return fail(-32601, "Method not found");
				const outpoints = params[0] as Outpoint[];
				return reply(
					outpoints.map((o) => {
						const s = this.spender(this.mempoolTxs, o.txid, o.vout);
						return { ...o, ...(s ? { spendingtxid: s.txid } : {}) };
					}),
				);
			}
			case "getbestblockhash":
				return reply(this.blocks.at(-1)?.hash);
			case "getblockheader": {
				const i = this.blocks.findIndex((b) => b.hash === params[0]);
				if (i < 0) return fail(-5, "Block not found");
				return reply({ hash: params[0], height: BASE + i });
			}
			case "getblockhash": {
				const block = this.blocks[(params[0] as number) - BASE];
				if (!block) return fail(-8, "Block height out of range");
				return reply(block.hash);
			}
			case "getblock": {
				this.getblockCalls++;
				if (this.gate) await this.gate;
				const block = this.blocks.find((b) => b.hash === params[0]);
				if (!block) return fail(-5, "Block not found");
				return reply(block.hex);
			}
			default:
				return fail(-32601, "Method not found");
		}
	}
}

let chain = new FakeBitcoind();
const server = Bun.serve({
	port: 0,
	hostname: "127.0.0.1",
	async fetch(req) {
		const { method, params } = (await req.json()) as {
			method: string;
			params: unknown[];
		};
		return chain.handle(method, params);
	},
});
const RPC = { url: `http://127.0.0.1:${server.port}` };

const KEY = "sk-sl_outspend_fixture";
const INTERNAL_KEY = "sk-sl_outspend_internal_fixture";
// No account_id: the credits gate and meter have nothing to read or debit.
const TOKENS: IndexTokenStore = new Map([
	[
		KEY,
		{ tenant_id: "tenant_outspend", tier: "free", scopes: [INDEX_READ_SCOPE] },
	],
	[
		INTERNAL_KEY,
		{
			tenant_id: "tenant_outspend_internal",
			tier: "internal",
			scopes: [INDEX_READ_SCOPE],
		},
	],
]);

function app(
	opts: Partial<BitcoinRouterOptions> = {},
	outspend: OutspendOptions = {},
) {
	const a = new Hono();
	a.onError(errorHandler);
	a.route(
		"/v1/bitcoin",
		createBitcoinRouter({
			tokens: TOKENS,
			bitcoinRpc: () => RPC,
			outspend,
			...opts,
		}),
	);
	return a;
}

type Body = Record<string, unknown>;

async function outspend(
	a: Hono,
	txid: string,
	vout: number | string,
	key?: string,
): Promise<{ status: number; body: Body; res: Response }> {
	const res = await a.request(`/v1/bitcoin/outspend/${txid}/${vout}`, {
		headers: key ? { authorization: `Bearer ${key}` } : {},
	});
	return { status: res.status, body: (await res.json()) as Body, res };
}

/** A confirmed two-output funding tx at BASE + 1. */
function fund(): string {
	chain.mine();
	const hex = rawTx([{ txid: "11".repeat(32), vout: 0 }], [P2WPKH, P2WPKH]);
	chain.mine([hex]);
	return parseTransaction(hex).txid;
}

let prevMode: string | undefined;
beforeAll(() => {
	prevMode = process.env.INSTANCE_MODE;
});
afterAll(() => {
	server.stop(true);
	if (prevMode === undefined) delete process.env.INSTANCE_MODE;
	else process.env.INSTANCE_MODE = prevMode;
});
beforeEach(async () => {
	process.env.INSTANCE_MODE = "oss";
	chain = new FakeBitcoind();
	await _resetRateLimitStoreForTests();
});

describe("GET /v1/bitcoin/outspend/:txid/:vout", () => {
	test("an unspent output", async () => {
		const txid = fund();
		const { status, body, res } = await outspend(app(), txid, 1);
		expect(status).toBe(200);
		expect(body).toEqual({ txid, vout: 1, spent: false });
		expect(res.headers.get("cache-control")).toBe(MUTABLE_CACHE_CONTROL);
		expect(chain.getblockCalls).toBe(0);
	});

	test("an output spent in a block names the spender, its input and the block", async () => {
		const txid = fund();
		chain.mineEmpty(3);
		const spender = rawTx([
			{ txid: "22".repeat(32), vout: 7 },
			{ txid, vout: 1 },
		]);
		const blockHash = chain.mine([
			rawTx([{ txid: "33".repeat(32), vout: 0 }]),
			spender,
		]);
		chain.mineEmpty(2);
		const { status, body } = await outspend(
			app(),
			`0x${txid.toUpperCase()}`,
			1,
		);
		expect(status).toBe(200);
		expect(body).toEqual({
			txid,
			vout: 1,
			spent: true,
			spending_txid: parseTransaction(spender).txid,
			spending_vin: 1,
			confirmed: true,
			mempool: false,
			block_height: BASE + 5,
			block_hash: blockHash,
		});
		// Walked back from the tip: two empty blocks, then the spending one.
		expect(chain.getblockCalls).toBe(3);
	});

	test("a found spender is remembered: the next read scans nothing", async () => {
		const txid = fund();
		chain.mine([rawTx([{ txid, vout: 0 }])]);
		const a = app();
		await outspend(a, txid, 0);
		const before = chain.getblockCalls;
		chain.mineEmpty(1);
		const { body } = await outspend(a, txid, 0);
		expect(body.block_height).toBe(BASE + 2);
		expect(chain.getblockCalls).toBe(before);
	});

	test("watchers of several outpoints at a new tip share one block read", async () => {
		const txid = fund();
		chain.mine([rawTx([{ txid, vout: 0 }]), rawTx([{ txid, vout: 1 }])]);
		const a = app();
		const [first, second] = await Promise.all([
			outspend(a, txid, 0),
			outspend(a, txid, 1),
		]);
		expect(first.body.spent).toBe(true);
		expect(second.body.spent).toBe(true);
		expect(chain.getblockCalls).toBe(1);
	});

	test("an output spent in the mempool", async () => {
		const txid = fund();
		const spender = chain.broadcast(
			rawTx([
				{ txid: "44".repeat(32), vout: 0 },
				{ txid: "55".repeat(32), vout: 2 },
				{ txid, vout: 0 },
			]),
		);
		const { status, body } = await outspend(app(), txid, 0);
		expect(status).toBe(200);
		expect(body).toEqual({
			txid,
			vout: 0,
			spent: true,
			spending_txid: spender,
			spending_vin: 2,
			confirmed: false,
			mempool: true,
			block_height: null,
			block_hash: null,
		});
		expect(chain.getblockCalls).toBe(0);
	});

	test("a mempool spend that confirms is found without a scan", async () => {
		const txid = fund();
		const a = app();
		const spender = chain.broadcast(rawTx([{ txid, vout: 0 }]));
		await outspend(a, txid, 0);
		const blockHash = chain.mine();
		chain.mine();
		const { body } = await outspend(a, txid, 0);
		expect(body).toMatchObject({
			spending_txid: spender,
			spending_vin: 0,
			confirmed: true,
			mempool: false,
			block_height: BASE + 2,
			block_hash: blockHash,
		});
		expect(chain.getblockCalls).toBe(0);
	});

	test("a reorg that returns the spender to the mempool reports it there", async () => {
		const txid = fund();
		chain.mine([rawTx([{ txid, vout: 0 }])]);
		const a = app();
		expect((await outspend(a, txid, 0)).body.confirmed).toBe(true);
		chain.disconnectTip();
		const { body } = await outspend(a, txid, 0);
		expect(body).toMatchObject({ confirmed: false, mempool: true });
	});

	test("an output spent by a tx in its own block", async () => {
		const funding = rawTx([{ txid: "66".repeat(32), vout: 0 }]);
		const txid = parseTransaction(funding).txid;
		chain.mine();
		chain.mine([funding, rawTx([{ txid, vout: 0 }])]);
		const { body } = await outspend(app(), txid, 0);
		expect(body).toMatchObject({ spent: true, block_height: BASE + 1 });
	});

	test("an unknown txid is a 404", async () => {
		fund();
		const { status, body } = await outspend(app(), "ee".repeat(32), 0);
		expect(status).toBe(404);
		expect(body.code).toBe("NOT_FOUND");
		expect(body.error).toContain("no Bitcoin transaction");
	});

	test("a vout past the last output is a 404", async () => {
		const txid = fund();
		const { status, body } = await outspend(app(), txid, 2);
		expect(status).toBe(404);
		expect(body.code).toBe("NOT_FOUND");
		expect(body.error).toContain("2 outputs");
	});

	test("an OP_RETURN output is a 404, not a spend", async () => {
		chain.mine();
		const hex = rawTx(
			[{ txid: "77".repeat(32), vout: 0 }],
			[P2WPKH, OP_RETURN],
		);
		chain.mine([hex]);
		const { status, body } = await outspend(
			app(),
			parseTransaction(hex).txid,
			1,
		);
		expect(status).toBe(404);
		expect(body.error).toContain("OP_RETURN");
		expect(chain.getblockCalls).toBe(0);
	});

	test.each([
		["zz".repeat(32), 0],
		["ab".repeat(31), 0],
		["ab".repeat(32), -1],
		["ab".repeat(32), "1.5"],
		["ab".repeat(32), "4294967296"],
	])("a malformed outpoint (%s, %s) is a 400", async (txid, vout) => {
		const { status, body } = await outspend(app(), txid, vout);
		expect(status).toBe(400);
		expect(body.code).toBe("VALIDATION_ERROR");
	});

	test("no Bitcoin node configured is a 503", async () => {
		const { status, body } = await outspend(
			app({ bitcoinRpc: () => undefined }),
			"ab".repeat(32),
			0,
		);
		expect(status).toBe(503);
		expect(body.code).toBe("BITCOIN_UNAVAILABLE");
	});

	test("an unreachable bitcoind is a 502 that does not name the URL", async () => {
		const { status, body } = await outspend(
			app({ bitcoinRpc: () => ({ url: "http://127.0.0.1:1" }) }),
			"ab".repeat(32),
			0,
		);
		expect(status).toBe(502);
		expect(body.code).toBe("BITCOIN_SOURCE_ERROR");
		expect(body.error).not.toContain("127.0.0.1");
	});

	test("a bitcoind without gettxspendingprevout says what it needs", async () => {
		const txid = fund();
		chain.mine([rawTx([{ txid, vout: 0 }])]);
		chain.hasSpendingPrevout = false;
		const { status, body } = await outspend(app(), txid, 0);
		expect(status).toBe(502);
		expect(body.error).toContain("gettxspendingprevout");
	});
});

describe("scan cap", () => {
	test("a spend deeper than the window is spent, with no spender, and is not scanned again", async () => {
		const txid = fund();
		chain.mine([rawTx([{ txid, vout: 0 }])]);
		chain.mineEmpty(20);
		const a = app({}, { scanBlocks: 5 });
		const first = await outspend(a, txid, 0);
		expect(first.status).toBe(200);
		expect(first.body).toMatchObject({
			spent: true,
			spending_txid: null,
			spending_vin: null,
			confirmed: true,
			mempool: false,
			block_height: null,
			block_hash: null,
		});
		expect(first.body.note).toContain("more than 5 blocks below the tip");
		expect(chain.getblockCalls).toBe(5);

		chain.mineEmpty(3);
		const second = await outspend(a, txid, 0);
		expect(second.body.note).toContain("more than 5 blocks");
		expect(chain.getblockCalls).toBe(5);
	});

	test("the window stops at the output's own block", async () => {
		const txid = fund();
		chain.mine([rawTx([{ txid, vout: 0 }])]);
		chain.mineEmpty(2);
		await outspend(app(), txid, 0);
		// Tip BASE+4 down to the spend at BASE+2: three reads, never below.
		expect(chain.getblockCalls).toBe(3);
	});

	test("the default window is one day of blocks", async () => {
		const { OUTSPEND_SCAN_BLOCKS } = await import("../bitcoin/outspend.ts");
		expect(OUTSPEND_SCAN_BLOCKS).toBe(144);
	});

	test("block reads past the in-flight and waiting limits answer 503", async () => {
		const txid = fund();
		chain.mine([rawTx([{ txid, vout: 0 }])]);
		let release = () => {};
		chain.gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const a = app({}, { maxBlockReads: 1, maxWaiting: 0 });
		const held = outspend(a, txid, 0);
		// The first lookup now holds the only block-read slot.
		while (chain.getblockCalls === 0) await Bun.sleep(1);
		// A new tip is a block nobody has read yet.
		chain.mine([rawTx([{ txid, vout: 1 }])]);
		const busy = await outspend(a, txid, 1);
		expect(busy.status).toBe(503);
		expect(busy.body.code).toBe("BITCOIN_BUSY");
		expect(busy.res.headers.get("retry-after")).toBe("2");
		chain.gate = null;
		release();
		expect((await held).body.spent).toBe(true);
		// The refused read was not cached as a failure.
		expect((await outspend(a, txid, 1)).body.block_height).toBe(BASE + 3);
	});
});

describe("hosted", () => {
	beforeEach(() => {
		process.env.INSTANCE_MODE = "platform";
	});

	test("a key is required", async () => {
		const { status } = await outspend(app(), "ab".repeat(32), 0);
		expect(status).toBe(401);
	});

	test("rate limited per key, with the limit's headers", async () => {
		const txid = fund();
		const a = app();
		const { limit } = OUTSPEND_RATE_LIMIT;
		for (let i = 0; i < limit; i++) {
			const { status, res } = await outspend(a, txid, 0, KEY);
			expect(status).toBe(200);
			expect(res.headers.get("x-ratelimit-limit")).toBe(String(limit));
		}
		const limited = await outspend(a, txid, 0, KEY);
		expect(limited.status).toBe(429);
		expect(limited.res.headers.get("retry-after")).not.toBeNull();
	});

	test("internal keys are not rate limited", async () => {
		const txid = fund();
		const a = app();
		for (let i = 0; i <= OUTSPEND_RATE_LIMIT.limit; i++) {
			expect((await outspend(a, txid, 0, INTERNAL_KEY)).status).toBe(200);
		}
	});

	test("self-host is not rate limited", async () => {
		process.env.INSTANCE_MODE = "oss";
		const txid = fund();
		const { res } = await outspend(app(), txid, 0);
		expect(res.headers.get("x-ratelimit-limit")).toBeNull();
	});
});
