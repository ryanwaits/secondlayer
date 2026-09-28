import { beforeEach, describe, expect, test } from "bun:test";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { sql } from "kysely";
import {
	ContinuityError,
	checkContinuity,
	fetchBlocksInOrder,
	runBackfill,
} from "./backfill.ts";
import { migrateToLatest } from "./db/migrate.ts";
import { dropReadIndexes, ensureReadIndexes } from "./db/read-indexes.ts";
import { openStore } from "./db/store.ts";
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

// --- runBackfill: deferred read indexes (plan 089) -----------------------
// DB-backed. Skipped when BITCOIN_TEST_DATABASE_URL isn't set (same
// convention as follow.test.ts/rewind.test.ts):
//
//   BITCOIN_TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5440/bitcoin_backfill_test \
//     bun test src/backfill.test.ts
//
// Regtest + genesisHeight 0 (Runes activates at block 0 on regtest — see
// `BackfillOptions.network`'s own docstring): lets these tests run a tiny,
// fast fake chain instead of needing real mainnet-sized heights.

const testUrl = process.env.BITCOIN_TEST_DATABASE_URL;

const BOTH_READ_INDEXES = new Set([
	"rune_events_address_height_event_index_idx",
	"rune_events_txid_idx",
]);

async function readIndexNames(
	db: ReturnType<typeof openStore>,
): Promise<Set<string>> {
	const result = await sql<{ indexname: string }>`
		select indexname from pg_indexes
		where tablename = 'rune_events'
			and indexname in ('rune_events_address_height_event_index_idx', 'rune_events_txid_idx')
	`.execute(db);
	return new Set(result.rows.map((r) => r.indexname));
}

describe.skipIf(!testUrl)(
	"runBackfill: deferred read indexes (plan 089)",
	() => {
		// biome-ignore lint/style/noNonNullAssertion: describe.skipIf(!testUrl) guards this whole block
		const db = openStore(testUrl!);

		beforeEach(async () => {
			process.env.BITCOIN_DATABASE_URL = testUrl;
			await migrateToLatest();
			await sql`truncate table rune_entries, rune_balances, rune_events, btc_blocks, runes_checkpoint, rune_block_digests, rune_undo, btc_reorgs`.execute(
				db,
			);
			// A prior test that dropped the indexes and (by bug) never restored
			// them would otherwise leak into the next test — force a known-good
			// starting state regardless of test order.
			await ensureReadIndexes(db);
		});

		test("a gap over the threshold drops both indexes before the loop, and rebuilds them after the final flush", async () => {
			expect(await readIndexNames(db)).toEqual(BOTH_READ_INDEXES);

			const rpc = new FakeRpc([0, 1, 2, 3, 4, 5]);
			// Snapshots fired from inside `onFlush`, for every flush except the
			// final one — the final flush's `onFlush` races `ensureReadIndexes`
			// (which runs right after the loop ends), so it's asserted after
			// `runBackfill` resolves instead, not from inside the hook.
			const midFlushSnapshots: Promise<Set<string>>[] = [];

			await runBackfill({
				db,
				rpc,
				toHeight: 5,
				fetchConcurrency: 4,
				flushInterval: 2,
				deferIndexThreshold: 3, // gap = 5 - 0 = 5 > 3
				network: Network.Regtest,
				genesisHeight: 0,
				onFlush: (stats) => {
					if (stats.height === 5) return; // final flush — see above
					midFlushSnapshots.push(readIndexNames(db));
				},
			});

			expect(midFlushSnapshots.length).toBeGreaterThan(0);
			for (const snapshot of await Promise.all(midFlushSnapshots)) {
				expect(snapshot).toEqual(new Set());
			}
			expect(await readIndexNames(db)).toEqual(BOTH_READ_INDEXES);
		});

		test("under the threshold, indexes are never dropped", async () => {
			expect(await readIndexNames(db)).toEqual(BOTH_READ_INDEXES);

			const rpc = new FakeRpc([0, 1, 2]);
			const flushSnapshots: Promise<Set<string>>[] = [];

			await runBackfill({
				db,
				rpc,
				toHeight: 2,
				fetchConcurrency: 4,
				flushInterval: 1,
				deferIndexThreshold: 10, // gap = 2 - 0 = 2, not > 10
				network: Network.Regtest,
				genesisHeight: 0,
				onFlush: () => {
					flushSnapshots.push(readIndexNames(db));
				},
			});

			expect(flushSnapshots.length).toBeGreaterThan(0);
			for (const snapshot of await Promise.all(flushSnapshots)) {
				expect(snapshot).toEqual(BOTH_READ_INDEXES);
			}
			expect(await readIndexNames(db)).toEqual(BOTH_READ_INDEXES);
		});

		test("ensureReadIndexes is idempotent and restores exactly 0005's definitions", async () => {
			const freshDefs = (
				await sql<{ indexname: string; indexdef: string }>`
					select indexname, indexdef from pg_indexes
					where tablename = 'rune_events'
						and indexname in ('rune_events_address_height_event_index_idx', 'rune_events_txid_idx')
					order by indexname
				`.execute(db)
			).rows;
			expect(freshDefs).toHaveLength(2);

			await dropReadIndexes(db);
			expect(await readIndexNames(db)).toEqual(new Set());
			// dropReadIndexes is itself idempotent — dropping twice in a row
			// (nothing left to drop the second time) doesn't throw.
			await dropReadIndexes(db);
			expect(await readIndexNames(db)).toEqual(new Set());

			await ensureReadIndexes(db);
			await ensureReadIndexes(db); // idempotent: second call is a no-op

			const restoredDefs = (
				await sql<{ indexname: string; indexdef: string }>`
					select indexname, indexdef from pg_indexes
					where tablename = 'rune_events'
						and indexname in ('rune_events_address_height_event_index_idx', 'rune_events_txid_idx')
					order by indexname
				`.execute(db)
			).rows;

			expect(restoredDefs).toEqual(freshDefs);
		});
	},
);
