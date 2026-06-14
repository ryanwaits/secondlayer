import { describe, expect, test } from "bun:test";
import type { StreamsEvent } from "@secondlayer/sdk";
import type {
	ReadCanonicalStreamsEventsParams,
	ReadCanonicalStreamsEventsResult,
} from "../streams-events.ts";
import { backfillSbtc } from "./backfill-sbtc-from-decoded.ts";
import type { SbtcEventRow, SbtcTokenEventRow } from "./sbtc-storage.ts";

// A real canonical print event for an sBTC completed-deposit (prod cursor
// 8282958:2). The payload carries `raw_value` (canonical Clarity hex) exactly as
// readCanonicalStreamsEvents emits it, so decodeRegistryPrint decodes it 1:1.
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

const BURN_EVENT: StreamsEvent = {
	cursor: "8116923:2",
	block_height: 8116923,
	block_hash: "",
	burn_block_height: 0,
	tx_id: "0xfeed",
	tx_index: 1,
	event_index: 2,
	event_type: "ft_burn",
	contract_id: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token",
	payload: {
		asset_identifier:
			"SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token",
		amount: "50186271440",
		sender: "SM35BNE8A592DRTQ7XVF1T3KY37XEZTPGGDC8EQYP",
	},
	ts: "2026-06-10T00:00:00.000Z",
} as StreamsEvent;

/** A one-page reader: returns the given events once, then an empty advanced page. */
function onePageReader(events: StreamsEvent[]) {
	let served = false;
	const calls: ReadCanonicalStreamsEventsParams[] = [];
	const read = async (
		params: ReadCanonicalStreamsEventsParams,
	): Promise<ReadCanonicalStreamsEventsResult> => {
		calls.push(params);
		if (served) {
			return { events: [], next_cursor: `${params.toHeight}:2147483647` };
		}
		served = true;
		return { events, next_cursor: events.at(-1)?.cursor ?? null };
	};
	return { read, calls };
}

describe("backfillSbtc (firehose replay → sbtc rows)", () => {
	test("events target decodes registry prints and writes them", async () => {
		const { read, calls } = onePageReader([DEPOSIT_EVENT]);
		const written: SbtcEventRow[] = [];
		const stats = await backfillSbtc({
			target: "events",
			apply: true,
			fromHeight: 0,
			toHeight: 8_300_000,
			limit: 500,
			maxBatches: 10,
			deps: {
				readEvents: read,
				writeEvents: async (rows) => {
					written.push(...rows);
				},
				network: "mainnet",
			},
		});
		expect(stats.eventsWritten).toBe(1);
		expect(stats.topics["completed-deposit"]).toBe(1);
		expect(written[0]?.topic).toBe("completed-deposit");
		expect(written[0]?.amount).toBe("14740");
		expect(written[0]?.cursor).toBe("8282958:2");
		// the reader is filtered to print + the registry contract
		expect(calls[0]?.types).toEqual(["print"]);
		expect(calls[0]?.contractId).toContain("sbtc-registry");
	});

	test("dry run decodes but does not write", async () => {
		const { read } = onePageReader([DEPOSIT_EVENT]);
		let wrote = 0;
		const stats = await backfillSbtc({
			target: "events",
			apply: false,
			fromHeight: 0,
			toHeight: 8_300_000,
			limit: 500,
			maxBatches: 10,
			deps: {
				readEvents: read,
				writeEvents: async () => {
					wrote += 1;
				},
				network: "mainnet",
			},
		});
		expect(stats.eventsWritten).toBe(1); // decoded count
		expect(wrote).toBe(0); // but never written
	});

	test("token target decodes ft events into token rows", async () => {
		const { read, calls } = onePageReader([BURN_EVENT]);
		const written: SbtcTokenEventRow[] = [];
		const stats = await backfillSbtc({
			target: "token",
			apply: true,
			fromHeight: 0,
			toHeight: 8_300_000,
			limit: 500,
			maxBatches: 10,
			deps: {
				readEvents: read,
				writeTokens: async (rows) => {
					written.push(...rows);
				},
				network: "mainnet",
			},
		});
		expect(stats.tokenWritten).toBe(1);
		expect(written[0]?.event_type).toBe("burn");
		expect(written[0]?.amount).toBe("50186271440");
		expect(written[0]?.recipient).toBeNull();
		expect(calls[0]?.types).toEqual(["ft_mint", "ft_burn", "ft_transfer"]);
		expect(calls[0]?.contractId).toContain("sbtc-token");
	});
});
