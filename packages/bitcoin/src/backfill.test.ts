import { describe, expect, test } from "bun:test";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import {
	ContinuityError,
	checkContinuity,
	fetchBlocksInOrder,
} from "./backfill.ts";
import type { BitcoinRpcClient, BlockHeader } from "./rpc.ts";
import { Network } from "./runes/rune.ts";

// --- A minimal, real (wire-format-parseable) fake chain, for
// fetchBlocksInOrder only — no runestone markers, so resolveBlockCommitments
// never needs a real getrawtransaction/getblockheader (unlike follow.test.ts,
// this never goes through verifyBlockIntegrity/checkContinuity either, so the
// blocks don't need to be byte-perfect, just parseable by `parseBlock`).

function doubleSha256(data: Uint8Array): Uint8Array {
	return sha256(sha256(data));
}
function reversed(bytes: Uint8Array): Uint8Array {
	return Uint8Array.from(bytes).reverse();
}
function u32le(n: number): Uint8Array {
	const b = new Uint8Array(4);
	new DataView(b.buffer).setUint32(0, n, true);
	return b;
}
function u64le(n: bigint): Uint8Array {
	const b = new Uint8Array(8);
	new DataView(b.buffer).setBigUint64(0, n, true);
	return b;
}
function concatBytes(chunks: Uint8Array[]): Uint8Array {
	const total = chunks.reduce((n, c) => n + c.length, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const c of chunks) {
		out.set(c, offset);
		offset += c.length;
	}
	return out;
}
function buildCoinbaseTx(nonce: number): Uint8Array {
	const scriptSig = u32le(nonce);
	return concatBytes([
		u32le(1),
		Uint8Array.of(1),
		new Uint8Array(32),
		u32le(0xffffffff),
		Uint8Array.of(scriptSig.length),
		scriptSig,
		u32le(0xffffffff),
		Uint8Array.of(1),
		u64le(0n),
		Uint8Array.of(0),
		u32le(0),
	]);
}
function buildBlock(
	prevHashDisplay: string,
	nonce: number,
): { hex: string; hash: string } {
	const coinbase = buildCoinbaseTx(nonce);
	const merkleRoot = doubleSha256(coinbase);
	const header = concatBytes([
		u32le(1),
		reversed(hexToBytes(prevHashDisplay)),
		merkleRoot,
		u32le(1_700_000_000 + nonce),
		u32le(0),
		u32le(0),
	]);
	const hash = bytesToHex(reversed(doubleSha256(header)));
	const hex = bytesToHex(concatBytes([header, Uint8Array.of(1), coinbase]));
	return { hex, hash };
}
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A tiny fake chain for `fetchBlocksInOrder`. `failure`, if set, makes `getblockhash` for that one height hang for `delayMs` before rejecting — reproducing "a fetch ahead of the yield point rejects while the consumer is busy" (plan 076). */
class FakeRpc implements BitcoinRpcClient {
	private readonly blocks = new Map<number, { hash: string; hex: string }>();

	constructor(
		heights: number[],
		private readonly failure?: {
			height: number;
			delayMs: number;
			message: string;
		},
	) {
		let prev = "0".repeat(64);
		for (const height of heights) {
			const { hex, hash } = buildBlock(prev, height);
			this.blocks.set(height, { hex, hash });
			prev = hash;
		}
	}

	async getblockcount(): Promise<number> {
		throw new Error("FakeRpc: getblockcount not needed by these tests");
	}
	async getblockhash(height: number): Promise<string> {
		if (this.failure?.height === height) {
			await sleep(this.failure.delayMs);
			throw new Error(this.failure.message);
		}
		const block = this.blocks.get(height);
		if (!block) throw new Error(`FakeRpc: no block at height ${height}`);
		return block.hash;
	}
	async getblock(hash: string): Promise<string> {
		for (const block of this.blocks.values()) {
			if (block.hash === hash) return block.hex;
		}
		throw new Error(`FakeRpc: unknown block hash ${hash}`);
	}
	async getblockheader(): Promise<BlockHeader> {
		throw new Error("FakeRpc: getblockheader not needed by these tests");
	}
	getrawtransaction: BitcoinRpcClient["getrawtransaction"] = (() => {
		throw new Error("FakeRpc: getrawtransaction not needed by these tests");
	}) as BitcoinRpcClient["getrawtransaction"];
	async waitfornewblock(): Promise<{ hash: string; height: number }> {
		throw new Error("FakeRpc: waitfornewblock not needed by these tests");
	}
	async getbestblockhash(): Promise<string> {
		throw new Error("FakeRpc: getbestblockhash not needed by these tests");
	}
}

describe("fetchBlocksInOrder", () => {
	test("a fetch that rejects ahead of the yield point still surfaces its error — not lost, not a hang", async () => {
		const rpc = new FakeRpc([1, 2, 3, 4, 5], {
			height: 4,
			delayMs: 100,
			message: "boom at height 4",
		});
		const gen = fetchBlocksInOrder(rpc, 1, 5, 5, Network.Bitcoin);

		const first = await gen.next();
		expect(first.done).toBe(false);
		expect(first.value?.height).toBe(1);

		// Simulate a slow consumer: height 4's fetch rejects in the background,
		// well before we ever pull the generator forward again.
		await sleep(150);

		await expect(
			(async () => {
				for await (const _ of gen) {
					// drain — the rejection must surface, not hang forever.
				}
			})(),
		).rejects.toThrow("boom at height 4");
	});

	test("an empty inFlight with no result for the next height throws instead of hanging on Promise.race([])", async () => {
		const rpc = new FakeRpc([1, 2, 3]);
		// concurrency 0: nothing is ever launched, so the loop invariant
		// ("inFlight is non-empty whenever nextToYield hasn't been fetched")
		// is violated on the very first iteration.
		const gen = fetchBlocksInOrder(rpc, 1, 3, 0, Network.Bitcoin);

		await expect(gen.next()).rejects.toThrow(/invariant/i);
	});
});

describe("checkContinuity", () => {
	test("does not throw on the first block ever applied (no previous hash)", () => {
		expect(() =>
			checkContinuity(840_000, { prevHash: "a".repeat(64) }, undefined),
		).not.toThrow();
	});

	test("does not throw when prevHash matches the last applied block's hash", () => {
		const lastHash = "b".repeat(64);
		expect(() =>
			checkContinuity(840_001, { prevHash: lastHash }, lastHash),
		).not.toThrow();
	});

	test("throws when a block's prevHash does not match the last applied block's hash", () => {
		const lastHash = "c".repeat(64);
		const wrongPrevHash = "d".repeat(64);
		expect(() =>
			checkContinuity(840_001, { prevHash: wrongPrevHash }, lastHash),
		).toThrow(ContinuityError);
	});
});
