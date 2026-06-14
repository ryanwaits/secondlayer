import { describe, expect, test } from "bun:test";
import {
	type DecodedRow,
	toStreamsEvent,
} from "./backfill-sbtc-from-decoded.ts";
import { decodeRegistryPrint, decodeTokenEvent } from "./decoders/sbtc.ts";

// A real `decoded_events` print row for an sBTC completed-deposit (prod cursor
// 8282958:2). The jsonb payload carries `raw_value` (canonical Clarity hex) —
// the same form the live Streams path supplies — so decodeRegistryPrint decodes
// it identically whether it comes from Streams or this backfill.
const DEPOSIT_PRINT: DecodedRow = {
	cursor: "8282958:2",
	block_height: 8282958,
	tx_id: "0xdeadbeef",
	tx_index: 0,
	event_index: 2,
	event_type: "print",
	contract_id: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry",
	asset_identifier: null,
	sender: null,
	recipient: null,
	amount: null,
	memo: null,
	payload: {
		topic: "print",
		raw_value:
			"0x0c0000000706616d6f756e7401000000000000000000000000000039940c626974636f696e2d747869640200000020b6a09ff900805957388db8414957c4e0cc75f70f566913dfa065ae797ce8f668096275726e2d68617368020000002000000000000000000000a46042864fe7918752a4bc263376cda46a44fc07ffa10b6275726e2d68656967687401000000000000000000000000000e8d4b0c6f75747075742d696e64657801000000000000000000000000000000000a73776565702d74786964020000002095a3cc4b7345bea50e873e09e2efbc3233cdac443f6e2cea89c6567f5dd2fc1505746f7069630d00000011636f6d706c657465642d6465706f736974",
	},
	block_ts: 1_749_000_000,
};

const BURN_FT: DecodedRow = {
	cursor: "8116923:2",
	block_height: 8116923,
	tx_id: "0xfeed",
	tx_index: 1,
	event_index: 2,
	event_type: "ft_burn",
	contract_id: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token",
	asset_identifier:
		"SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token",
	sender: "SM35BNE8A592DRTQ7XVF1T3KY37XEZTPGGDC8EQYP",
	recipient: null,
	amount: "50186271440",
	memo: null,
	payload: null,
	block_ts: 1_748_000_000,
};

describe("backfill decoded_events → sbtc rows", () => {
	test("a print row decodes to the correct completed-deposit", () => {
		const row = decodeRegistryPrint(toStreamsEvent(DEPOSIT_PRINT));
		expect(row).not.toBeNull();
		expect(row?.topic).toBe("completed-deposit");
		expect(row?.amount).toBe("14740");
		expect(row?.bitcoin_txid).toBe(
			"0xb6a09ff900805957388db8414957c4e0cc75f70f566913dfa065ae797ce8f668",
		);
		expect(row?.sweep_txid).toBe(
			"0x95a3cc4b7345bea50e873e09e2efbc3233cdac443f6e2cea89c6567f5dd2fc15",
		);
		expect(row?.cursor).toBe("8282958:2");
		expect(row?.source_cursor).toBe("8282958:2");
	});

	test("an ft_burn row maps flat columns into a token burn", () => {
		const row = decodeTokenEvent(toStreamsEvent(BURN_FT));
		expect(row).not.toBeNull();
		expect(row?.event_type).toBe("burn");
		expect(row?.amount).toBe("50186271440");
		expect(row?.sender).toBe("SM35BNE8A592DRTQ7XVF1T3KY37XEZTPGGDC8EQYP");
		// burns null the recipient
		expect(row?.recipient).toBeNull();
		expect(row?.cursor).toBe("8116923:2");
	});

	test("decodes a print row whose jsonb payload arrives as a JSON string", () => {
		// The raw-sql read path can return jsonb as a string; the mapper must parse it.
		const asString: DecodedRow = {
			...DEPOSIT_PRINT,
			payload: JSON.stringify(DEPOSIT_PRINT.payload),
		};
		const row = decodeRegistryPrint(toStreamsEvent(asString));
		expect(row?.topic).toBe("completed-deposit");
		expect(row?.amount).toBe("14740");
	});

	test("block_ts maps to an ISO block_time", () => {
		const ev = toStreamsEvent(DEPOSIT_PRINT);
		expect(ev.ts).toBe(new Date(1_749_000_000 * 1000).toISOString());
	});
});
