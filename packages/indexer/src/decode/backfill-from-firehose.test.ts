import { describe, expect, test } from "bun:test";
import type { StreamsEvent } from "@secondlayer/sdk";
import type {
	ReadCanonicalStreamsEventsParams,
	ReadCanonicalStreamsEventsResult,
} from "../streams-events.ts";
import {
	BACKFILL_REGISTRY,
	backfillFromFirehose,
} from "./backfill-from-firehose.ts";

// A real canonical print event for an sBTC completed-deposit (prod cursor
// 8282958:2). Its payload carries `raw_value` exactly as readCanonicalStreamsEvents
// emits it, so decodeRegistryPrint decodes it 1:1.
const DEPOSIT_EVENT: StreamsEvent = {
	cursor: "8282958:2",
	block_height: 8282958,
	block_hash: "",
	burn_block_height: 0,
	tx_id: "0xdeadbeef",
	tx_index: 0,
	event_index: 2,
	event_type: "print",
	contract_id: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry",
	payload: {
		topic: "print",
		raw_value:
			"0x0c0000000706616d6f756e7401000000000000000000000000000039940c626974636f696e2d747869640200000020b6a09ff900805957388db8414957c4e0cc75f70f566913dfa065ae797ce8f668096275726e2d68617368020000002000000000000000000000a46042864fe7918752a4bc263376cda46a44fc07ffa10b6275726e2d68656967687401000000000000000000000000000e8d4b0c6f75747075742d696e64657801000000000000000000000000000000000a73776565702d74786964020000002095a3cc4b7345bea50e873e09e2efbc3233cdac443f6e2cea89c6567f5dd2fc1505746f7069630d00000011636f6d706c657465642d6465706f736974",
	},
	ts: "2026-06-12T00:00:00.000Z",
} as StreamsEvent;

/** A one-page reader: serves the given events once, then an advanced empty page. */
function onePageReader(events: StreamsEvent[]) {
	let served = false;
	const calls: ReadCanonicalStreamsEventsParams[] = [];
	const read = async (
		params: ReadCanonicalStreamsEventsParams,
	): Promise<ReadCanonicalStreamsEventsResult> => {
		calls.push(params);
		if (served)
			return { events: [], next_cursor: `${params.toHeight}:2147483647` };
		served = true;
		return { events, next_cursor: events.at(-1)?.cursor ?? null };
	};
	return { read, calls };
}

describe("backfill-from-firehose", () => {
	test("registry lists the recent-only domain + floored generic decoders", () => {
		expect(BACKFILL_REGISTRY.map((e) => e.key).sort()).toEqual([
			"nft_burn",
			"nft_mint",
			"nft_transfer",
			"sbtc",
			"sbtc_token",
			"stx_burn",
			"stx_lock",
			"stx_mint",
			"stx_transfer",
		]);
	});

	test("generic decoders carry no contractId (all-contract scope = genesis-complete)", () => {
		for (const key of ["stx_transfer", "nft_transfer", "stx_lock"]) {
			const e = BACKFILL_REGISTRY.find((x) => x.key === key);
			expect(e?.contractId).toBeUndefined();
		}
		// Per-contract decoders still scope to their contract.
		expect(
			BACKFILL_REGISTRY.find((e) => e.key === "sbtc")?.contractId,
		).toBeDefined();
	});

	test("sbtc target replays the registry-print stream and decodes deposits", async () => {
		const { read, calls } = onePageReader([DEPOSIT_EVENT]);
		const [stats] = await backfillFromFirehose({
			target: "sbtc",
			apply: false, // dry: exercises decode without writing
			fromHeight: 0,
			toHeight: 8_300_000,
			limit: 500,
			maxBatches: 10,
			deps: { read, net: "mainnet" },
		});
		expect(stats.key).toBe("sbtc");
		expect(stats.written).toBe(1);
		expect(stats.topics["completed-deposit"]).toBe(1);
		expect(calls[0]?.types).toEqual(["print"]);
		expect(calls[0]?.contractId).toContain("sbtc-registry");
	});

	test("dedupes duplicate-cursor events within a page (reorg join doubling)", async () => {
		// Same event delivered twice in one page (a tx present in two blocks). The
		// batch upsert would otherwise throw ON CONFLICT; dedupe keeps one.
		const { read } = onePageReader([DEPOSIT_EVENT, { ...DEPOSIT_EVENT }]);
		const [stats] = await backfillFromFirehose({
			target: "sbtc",
			apply: false,
			fromHeight: 0,
			toHeight: 8_300_000,
			limit: 500,
			maxBatches: 10,
			deps: { read, net: "mainnet" },
		});
		expect(stats.written).toBe(1); // not 2
		expect(stats.topics["completed-deposit"]).toBe(1);
	});

	test("token target filters the firehose by ft types + token contract", async () => {
		const { read, calls } = onePageReader([]);
		await backfillFromFirehose({
			target: "sbtc_token",
			apply: false,
			fromHeight: 0,
			toHeight: 8_300_000,
			limit: 500,
			maxBatches: 10,
			deps: { read, net: "mainnet" },
		});
		expect(calls[0]?.types).toEqual(["ft_mint", "ft_burn", "ft_transfer"]);
		expect(calls[0]?.contractId).toContain("sbtc-token");
	});

	test("generic target filters by type with NO contract scope", async () => {
		const { read, calls } = onePageReader([]);
		await backfillFromFirehose({
			target: "stx_transfer",
			apply: false,
			fromHeight: 0,
			toHeight: 8_300_000,
			limit: 500,
			maxBatches: 10,
			deps: { read, net: "mainnet" },
		});
		expect(calls[0]?.types).toEqual(["stx_transfer"]);
		// The fix: generic decoders pass no contractId → firehose returns events
		// from ALL contracts, so the genesis backfill is complete (not per-contract).
		expect(calls[0]?.contractId).toBeUndefined();
	});

	test("unknown target throws with the known keys", async () => {
		await expect(
			backfillFromFirehose({
				target: "nope",
				apply: false,
				fromHeight: 0,
				toHeight: 1,
				limit: 1,
				maxBatches: 1,
				deps: { read: onePageReader([]).read, net: "mainnet" },
			}),
		).rejects.toThrow(/unknown --target/);
	});

	test("resumes from a persisted checkpoint instead of genesis", async () => {
		const { read, calls } = onePageReader([]);
		const writes: Array<[string, string]> = [];
		await backfillFromFirehose({
			target: "sbtc",
			apply: true,
			fromHeight: 0,
			toHeight: 8_300_000,
			limit: 500,
			maxBatches: 10,
			deps: {
				read,
				net: "mainnet",
				readCheckpoint: async (name) =>
					name === "backfill.sbtc" ? "7000000:3" : null,
				writeCheckpoint: async (name, cursor) => {
					writes.push([name, cursor]);
				},
			},
		});
		// First read resumes at the checkpoint cursor, not fromHeight=0.
		expect(calls[0]?.after).toEqual({ block_height: 7000000, event_index: 3 });
		expect(calls[0]?.fromHeight).toBeUndefined();
	});

	test("--restart (resume:false) ignores the checkpoint", async () => {
		const { read, calls } = onePageReader([]);
		await backfillFromFirehose({
			target: "sbtc",
			apply: true,
			fromHeight: 0,
			toHeight: 8_300_000,
			limit: 500,
			maxBatches: 10,
			resume: false,
			deps: {
				read,
				net: "mainnet",
				readCheckpoint: async () => "7000000:3",
				writeCheckpoint: async () => {},
			},
		});
		expect(calls[0]?.after).toBeUndefined();
		expect(calls[0]?.fromHeight).toBe(0);
	});

	test("all target runs every registered entry", async () => {
		const { read } = onePageReader([]);
		const stats = await backfillFromFirehose({
			target: "all",
			apply: false,
			fromHeight: 0,
			toHeight: 8_300_000,
			limit: 500,
			maxBatches: 10,
			deps: { read, net: "mainnet" },
		});
		expect(stats.map((s) => s.key)).toEqual([
			"sbtc",
			"sbtc_token",
			"stx_transfer",
			"stx_mint",
			"stx_burn",
			"stx_lock",
			"nft_transfer",
			"nft_mint",
			"nft_burn",
		]);
	});
});
