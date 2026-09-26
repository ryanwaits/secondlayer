// DB-backed follow.ts tests, with a fake RPC (a tiny in-memory chain, real
// enough to pass verifyBlockIntegrity/checkContinuity) and a fake notifier
// (manually fired — see rpc-wait-notifier.test.ts for the real notifier's own
// unit tests). Skipped when BITCOIN_TEST_DATABASE_URL isn't set (same
// convention as rewind.test.ts):
//
//   BITCOIN_TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5440/bitcoin_follow_test \
//     bun test src/follow.test.ts
import { beforeEach, describe, expect, test } from "bun:test";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { sql } from "kysely";
import { migrateToLatest } from "./db/migrate.ts";
import { openStore } from "./db/store.ts";
import {
	type BlockNotifier,
	type FollowDeps,
	type ReorgInfo,
	runFollow,
	syncOnce,
} from "./follow.ts";
import type { BitcoinRpcClient, BlockHeader } from "./rpc.ts";
import { UNDO_DEPTH } from "./runes/undo.ts";

const testUrl = process.env.BITCOIN_TEST_DATABASE_URL;

// --- A minimal, real (wire-format-valid) fake chain ---------------------
// Coinbase-only blocks with no runestones: `verifyBlockIntegrity` (merkle
// root + witness commitment) and `checkContinuity` (prevHash chaining) both
// validate real bytes, so a fake block still has to be a real one — just
// Runes-inert, since these tests are about the catch-up/reorg orchestration,
// not Runes decoding (covered elsewhere: updater.test.ts, digest.test.ts).

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
	const scriptSig = u32le(nonce); // arbitrary bytes, just makes the txid unique per block
	return concatBytes([
		u32le(1), // version
		Uint8Array.of(1), // input count
		new Uint8Array(32), // prevTxid = 0 (coinbase)
		u32le(0xffffffff), // prevVout
		Uint8Array.of(scriptSig.length),
		scriptSig,
		u32le(0xffffffff), // sequence
		Uint8Array.of(1), // output count
		u64le(0n), // value
		Uint8Array.of(0), // empty scriptPubKey
		u32le(0), // locktime
	]);
}

/** A coinbase-only block chained from `prevHashDisplay` — real enough to satisfy `verifyBlockIntegrity`/`checkContinuity`, with zero Runes activity. */
function buildBlock(
	prevHashDisplay: string,
	time: number,
	nonce: number,
): { hex: string; hash: string } {
	const coinbase = buildCoinbaseTx(nonce);
	const merkleRoot = doubleSha256(coinbase); // single-tx block: root == that tx's own internal-order hash
	const header = concatBytes([
		u32le(1), // version
		reversed(hexToBytes(prevHashDisplay)),
		merkleRoot,
		u32le(time),
		u32le(0), // bits
		u32le(0), // nonce
	]);
	const hash = bytesToHex(reversed(doubleSha256(header)));
	const hex = bytesToHex(concatBytes([header, Uint8Array.of(1), coinbase]));
	return { hex, hash };
}

const GENESIS_ANCHOR_HASH = "0".repeat(64); // never itself checked (the first-ever applied block skips checkContinuity)

class FakeChain implements BitcoinRpcClient {
	private blocksByHash = new Map<
		string,
		{ height: number; hex: string; prevHash: string }
	>();
	private activeHashAtHeight = new Map<number, string>();
	private nonceCounter = 0;

	/** Mines one block on top of `prevHash` at `height`, making it the active chain's block at that height (overwriting any prior one there — how a reorg is simulated). */
	mine(height: number, prevHash: string): string {
		this.nonceCounter += 1;
		const { hex, hash } = buildBlock(
			prevHash,
			1_700_000_000 + height,
			this.nonceCounter,
		);
		this.blocksByHash.set(hash, { height, hex, prevHash });
		this.activeHashAtHeight.set(height, hash);
		return hash;
	}

	async getblockcount(): Promise<number> {
		return Math.max(...this.activeHashAtHeight.keys());
	}
	async getblockhash(height: number): Promise<string> {
		const hash = this.activeHashAtHeight.get(height);
		if (!hash)
			throw new Error(`FakeChain: no active block at height ${height}`);
		return hash;
	}
	async getblock(hash: string): Promise<string> {
		const block = this.blocksByHash.get(hash);
		if (!block) throw new Error(`FakeChain: unknown block hash ${hash}`);
		return block.hex;
	}
	async getblockheader(hash: string): Promise<BlockHeader> {
		const block = this.blocksByHash.get(hash);
		if (!block) throw new Error(`FakeChain: unknown block hash ${hash}`);
		return {
			hash,
			height: block.height,
			previousblockhash:
				block.prevHash === GENESIS_ANCHOR_HASH ? undefined : block.prevHash,
		};
	}
	getrawtransaction: BitcoinRpcClient["getrawtransaction"] = (() => {
		throw new Error("FakeChain: getrawtransaction not needed by these tests");
	}) as BitcoinRpcClient["getrawtransaction"];
	async waitfornewblock(): Promise<{ hash: string; height: number }> {
		throw new Error("FakeChain: waitfornewblock not needed by these tests");
	}
	async getbestblockhash(): Promise<string> {
		throw new Error("FakeChain: getbestblockhash not needed by these tests");
	}
}

class FakeNotifier implements BlockNotifier {
	private waiters: Array<() => void> = [];
	notified(): Promise<void> {
		return new Promise((resolve) => {
			this.waiters.push(resolve);
		});
	}
	fire(): void {
		const waiters = this.waiters;
		this.waiters = [];
		for (const resolve of waiters) resolve();
	}
	close(): void {}
}

const GENESIS_HEIGHT = 840_000;

describe.skipIf(!testUrl)("follow", () => {
	// biome-ignore lint/style/noNonNullAssertion: describe.skipIf(!testUrl) guards this whole block
	const db = openStore(testUrl!);

	beforeEach(async () => {
		process.env.BITCOIN_DATABASE_URL = testUrl;
		await migrateToLatest();
		await sql`truncate table rune_entries, rune_balances, rune_events, btc_blocks, runes_checkpoint, rune_block_digests, rune_undo, btc_reorgs`.execute(
			db,
		);
	});

	test("syncOnce extends the checkpoint by one when a new block lands", async () => {
		const chain = new FakeChain();
		const h0 = chain.mine(GENESIS_HEIGHT, GENESIS_ANCHOR_HASH);

		const deps: FollowDeps = { db, rpc: chain };
		const first = await syncOnce(deps);
		expect(first.state.height).toBe(GENESIS_HEIGHT);
		expect(first.state.hash).toBe(h0);
		expect(first.blocksApplied).toBe(1);

		const h1 = chain.mine(GENESIS_HEIGHT + 1, h0);
		const second = await syncOnce(deps);
		expect(second.state.height).toBe(GENESIS_HEIGHT + 1);
		expect(second.state.hash).toBe(h1);
		expect(second.blocksApplied).toBe(1);

		// A third pass with nothing new mined is a no-op.
		const third = await syncOnce(deps);
		expect(third.blocksApplied).toBe(0);
		expect(third.state.height).toBe(GENESIS_HEIGHT + 1);
	});

	test("a 2-block reorg rewinds to the fork point and re-applies the new branch", async () => {
		const chain = new FakeChain();
		const h0 = chain.mine(GENESIS_HEIGHT, GENESIS_ANCHOR_HASH);
		const a1 = chain.mine(GENESIS_HEIGHT + 1, h0);
		const a2 = chain.mine(GENESIS_HEIGHT + 2, a1);

		const reorgs: ReorgInfo[] = [];
		const deps: FollowDeps = {
			db,
			rpc: chain,
			onReorg: (info) => reorgs.push(info),
		};
		const before = await syncOnce(deps);
		expect(before.state.height).toBe(GENESIS_HEIGHT + 2);
		expect(before.state.hash).toBe(a2);

		// Orphan a1/a2: mine a longer... no, an equal-length replacement branch
		// from h0 (FakeChain.mine overwrites whatever was active at that height).
		const b1 = chain.mine(GENESIS_HEIGHT + 1, h0);
		const b2 = chain.mine(GENESIS_HEIGHT + 2, b1);
		expect(b1).not.toBe(a1);
		expect(b2).not.toBe(a2);

		const after = await syncOnce(deps);
		expect(after.state.height).toBe(GENESIS_HEIGHT + 2);
		expect(after.state.hash).toBe(b2);
		expect(reorgs).toHaveLength(1);
		expect(reorgs[0]?.forkHeight).toBe(GENESIS_HEIGHT);
		expect(reorgs[0]?.oldCheckpointHeight).toBe(GENESIS_HEIGHT + 2);

		const reorgRows = await db.selectFrom("btc_reorgs").selectAll().execute();
		expect(reorgRows).toHaveLength(1);
		expect(reorgRows[0]?.new_hash).toBe(h0);

		// btc_blocks now records the new branch, not the orphaned one.
		const b1Row = await db
			.selectFrom("btc_blocks")
			.select("hash")
			.where("height", "=", GENESIS_HEIGHT + 1)
			.executeTakeFirst();
		expect(b1Row?.hash).toBe(b1);
	});

	test("an orphaned checkpoint left over from a previous run is rewound on the next syncOnce", async () => {
		const chain = new FakeChain();
		const h0 = chain.mine(GENESIS_HEIGHT, GENESIS_ANCHOR_HASH);
		const a1 = chain.mine(GENESIS_HEIGHT + 1, h0);

		const deps: FollowDeps = { db, rpc: chain };
		await syncOnce(deps); // checkpoint now at a1 (height 840,001)

		// Simulate the process having been down while the chain moved on: a1 is
		// replaced by b1, and the chain has already advanced further to b2/b3 by
		// the time we come back — a fresh run (fresh `loadState`, no in-memory
		// state carried over) must still detect and rewind the orphan.
		const b1 = chain.mine(GENESIS_HEIGHT + 1, h0);
		const b2 = chain.mine(GENESIS_HEIGHT + 2, b1);
		const b3 = chain.mine(GENESIS_HEIGHT + 3, b2);
		expect(b1).not.toBe(a1);

		const result = await syncOnce({ db, rpc: chain });
		expect(result.state.height).toBe(GENESIS_HEIGHT + 3);
		expect(result.state.hash).toBe(b3);
	});

	test("runFollow drives syncOnce off the notifier and stops on abort", async () => {
		const chain = new FakeChain();
		const h0 = chain.mine(GENESIS_HEIGHT, GENESIS_ANCHOR_HASH);
		const deps: FollowDeps = { db, rpc: chain };
		const notifier = new FakeNotifier();
		const controller = new AbortController();

		const run = runFollow(deps, notifier, controller.signal);

		// runFollow's first pass runs immediately (before waiting on the
		// notifier) — give it a tick to land.
		await new Promise((resolve) => setTimeout(resolve, 20));
		let state = await import("./db/store.ts").then((m) => m.loadState(db));
		expect(state.height).toBe(GENESIS_HEIGHT);
		expect(state.hash).toBe(h0);

		const h1 = chain.mine(GENESIS_HEIGHT + 1, h0);
		notifier.fire();
		await new Promise((resolve) => setTimeout(resolve, 20));
		state = await import("./db/store.ts").then((m) => m.loadState(db));
		expect(state.height).toBe(GENESIS_HEIGHT + 1);
		expect(state.hash).toBe(h1);

		controller.abort();
		notifier.fire(); // unblock the pending notified() so runFollow can observe the abort and return
		await run;
	});

	test("a reorg deeper than UNDO_DEPTH surfaces as a thrown error, not a silent rewind", async () => {
		const chain = new FakeChain();
		const h0 = chain.mine(GENESIS_HEIGHT, GENESIS_ANCHOR_HASH);
		let prev = h0;
		for (
			let h = GENESIS_HEIGHT + 1;
			h <= GENESIS_HEIGHT + UNDO_DEPTH + 1;
			h++
		) {
			prev = chain.mine(h, prev);
		}
		const deps: FollowDeps = { db, rpc: chain };
		const result = await syncOnce(deps);
		expect(result.state.height).toBe(GENESIS_HEIGHT + UNDO_DEPTH + 1);

		// Replace every block from GENESIS_HEIGHT + 1 onward with a new branch
		// off the SAME h0 — the only common ancestor left is GENESIS_HEIGHT
		// itself, (UNDO_DEPTH + 1) blocks below the checkpoint.
		let newPrev = h0;
		for (
			let h = GENESIS_HEIGHT + 1;
			h <= GENESIS_HEIGHT + UNDO_DEPTH + 1;
			h++
		) {
			newPrev = chain.mine(h, newPrev);
		}

		await expect(syncOnce(deps)).rejects.toThrow();
	});
});
