import { describe, expect, test } from "bun:test";
import { buildEventPayload } from "../src/runtime/runner.ts";
import type { EventRecord, TxRecord } from "../src/runtime/source-matcher.ts";
import {
	type StateWriteRow,
	parseStateWriteKey,
	stateWriteEvents,
} from "../src/runtime/state-writes.ts";
import type { SubgraphFilter } from "../src/types.ts";

const POOL = "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.amm-vault-v2-01";
const TOKEN_KEY =
	"0616e685b016b3b6cd9ebf35f38e5ae29392e2acd51d0b746f6b656e2d776b696b69";
const AMOUNT = "0100000000000000000000000005f5e100";

/** Hex of a stored value string's UTF-8 bytes, as `state_writes.value_hex`. */
const stored = (s: string) => Buffer.from(s, "utf8").toString("hex");

const mapKey = (map: string, keyHex: string, contract = POOL) =>
	`vm::${contract}::0::${map}::${keyHex}`;
const varKey = (name: string, contract = POOL) => `vm::${contract}::1::${name}`;

function w(
	ordinal: number,
	tx_index: number | null,
	key: string,
	value: string,
): StateWriteRow {
	return { ordinal, tx_index, key, value_hex: stored(value) };
}

const TX0: TxRecord = {
	tx_id: "0xaa",
	type: "contract_call",
	sender: "SP000000000000000000002Q6VF78",
	status: "success",
	tx_index: 0,
	contract_id: POOL,
	function_name: "swap",
};
const TX1: TxRecord = { ...TX0, tx_id: "0xbb", tx_index: 1 };
const TXS = new Map([
	[0, TX0],
	[1, TX1],
]);

describe("parseStateWriteKey", () => {
	test("names map entries and data vars", () => {
		expect(parseStateWriteKey(mapKey("reserve", TOKEN_KEY))).toEqual({
			contractId: POOL,
			kind: "map",
			map: "reserve",
			rawKey: TOKEN_KEY,
		});
		expect(parseStateWriteKey(varKey("paused"))).toEqual({
			contractId: POOL,
			kind: "var",
			varName: "paused",
		});
	});

	test("every other key is not a handler input", () => {
		for (const key of [
			`vm::${POOL}::2::token::{"Standard":[22,[1,2]]}`,
			`vm::${POOL}::4::nft::0100`,
			`vm-metadata::9::contract::${POOL}`,
			"vm-account::SP000000000000000000002Q6VF78::stx",
			"__MARF_BLOCK_HEIGHT_SELF",
			"__MARF_BLOCK_HEIGHT_TO_HASH::12",
			`vm::${POOL}::0::reserve::not-hex`,
			"vm::no-dot::1::x",
		]) {
			expect(parseStateWriteKey(key)).toBeNull();
		}
	});
});

describe("stateWriteEvents", () => {
	test("map set, map delete and var become their events, hex-for-hex", () => {
		const { vmEvents } = stateWriteEvents(
			[
				w(3, 0, mapKey("reserve", TOKEN_KEY), `0a${AMOUNT}`),
				w(4, 0, mapKey("reserve", "0100"), "09"),
				w(5, 1, varKey("paused"), "03"),
			],
			TXS,
		);
		expect(vmEvents).toEqual([
			{
				id: "0xaa#vm:3",
				tx_id: "0xaa",
				type: "map_set",
				event_index: 3,
				clock: "vm",
				data: {
					contract_identifier: POOL,
					map_name: "reserve",
					raw_key: `0x${TOKEN_KEY}`,
					raw_value: `0x${AMOUNT}`,
				},
			},
			{
				id: "0xaa#vm:4",
				tx_id: "0xaa",
				type: "map_delete",
				event_index: 4,
				clock: "vm",
				data: {
					contract_identifier: POOL,
					map_name: "reserve",
					raw_key: "0x0100",
				},
			},
			{
				id: "0xbb#vm:5",
				tx_id: "0xbb",
				type: "var_set",
				event_index: 5,
				clock: "vm",
				data: {
					contract_identifier: POOL,
					var_name: "paused",
					raw_value: "0x03",
				},
			},
		]);
	});

	test("FT balances and MARF bookkeeping are dropped", () => {
		const { txs, vmEvents } = stateWriteEvents(
			[
				w(0, null, "__MARF_BLOCK_HEIGHT_SELF", "00"),
				w(1, 0, `vm::${POOL}::2::token::{"Standard":[22,[1]]}`, "0100"),
			],
			TXS,
		);
		expect(vmEvents).toEqual([]);
		expect(txs).toEqual([]);
	});

	test("block-level writes hang on one synthetic tx with an empty id", () => {
		const { txs, vmEvents } = stateWriteEvents(
			[
				w(0, null, varKey("epoch"), "01"),
				w(1, 0, varKey("paused"), "03"),
				w(2, null, varKey("epoch"), "02"),
			],
			TXS,
		);
		expect(txs.map((t) => [t.tx_id, t.type])).toEqual([
			["", "block"],
			["0xaa", "contract_call"],
		]);
		expect(vmEvents.map((e) => [e.id, e.tx_id])).toEqual([
			["block#vm:0", ""],
			["0xaa#vm:1", "0xaa"],
			["block#vm:2", ""],
		]);
	});

	test("a write naming a tx the block does not have throws", () => {
		expect(() =>
			stateWriteEvents([w(7, 9, varKey("paused"), "03")], TXS),
		).toThrow("state write 7 names tx_index 9 the block does not have");
	});

	test("events come out in ordinal order across txs, and every tx ranks equal so dispatch follows ordinal", () => {
		const { txs, vmEvents } = stateWriteEvents(
			[
				w(9, 1, varKey("b"), "02"),
				w(2, 0, varKey("a"), "01"),
				w(12, null, varKey("c"), "03"),
			],
			TXS,
		);
		expect(vmEvents.map((e) => e.event_index)).toEqual([2, 9, 12]);
		expect(new Set(txs.map((t) => t.tx_index))).toEqual(new Set([0]));
		// The caller's tx records are not mutated.
		expect(TX1.tx_index).toBe(1);
	});

	test("handler payloads equal the ones built from vm_events rows of the same writes", () => {
		const vmRows: EventRecord[] = [
			{
				id: "0xaa#vm:3",
				tx_id: "0xaa",
				type: "map_set",
				event_index: 3,
				clock: "vm",
				data: {
					contract_identifier: POOL,
					map_name: "reserve",
					raw_key: `0x${TOKEN_KEY}`,
					raw_value: `0x${AMOUNT}`,
				},
			},
			{
				id: "0xaa#vm:4",
				tx_id: "0xaa",
				type: "map_delete",
				event_index: 4,
				clock: "vm",
				data: {
					contract_identifier: POOL,
					map_name: "reserve",
					raw_key: `0x${TOKEN_KEY}`,
				},
			},
			{
				id: "0xbb#vm:5",
				tx_id: "0xbb",
				type: "var_set",
				event_index: 5,
				clock: "vm",
				data: {
					contract_identifier: POOL,
					var_name: "paused",
					raw_value: "0x03",
				},
			},
		];
		const { vmEvents } = stateWriteEvents(
			[
				w(3, 0, mapKey("reserve", TOKEN_KEY), `0a${AMOUNT}`),
				w(4, 0, mapKey("reserve", TOKEN_KEY), "09"),
				w(5, 1, varKey("paused"), "03"),
			],
			TXS,
		);
		const filters: Record<string, SubgraphFilter> = {
			map_set: { type: "map_set", contractId: POOL, map: "reserve" },
			map_delete: { type: "map_delete", contractId: POOL, map: "reserve" },
			var_set: { type: "var_set", contractId: POOL, varName: "paused" },
		};
		vmRows.forEach((row, i) => {
			const filter = filters[row.type] as SubgraphFilter;
			const tx = row.tx_id === "0xaa" ? TX0 : TX1;
			expect(buildEventPayload(filter, tx, vmEvents[i] ?? null)).toEqual(
				buildEventPayload(filter, tx, row),
			);
		});
		const set = buildEventPayload(
			filters.map_set as SubgraphFilter,
			TX0,
			vmEvents[0] ?? null,
		);
		expect(set.value).toBe(100_000_000n);
	});
});
