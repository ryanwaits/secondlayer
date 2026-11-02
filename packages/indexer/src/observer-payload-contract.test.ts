import { describe, expect, test } from "bun:test";
import { parseObserverBody } from "./observer-journal.ts";
import { parseBlock, parseStateWrites } from "./parser.ts";
import type {
	NewBlockPayload,
	StateWritePayload,
} from "./types/node-events.ts";

const HEX_LIKE = /^0x[0-9a-fA-F]+$/;

const FIXTURES = [
	{
		name: "timestamp",
		file: "new_block.timestamp.json",
		present: ["timestamp"] as const,
		absent: ["burn_block_time"] as const,
	},
	{
		name: "burn_block_time",
		file: "new_block.burn_block_time.json",
		present: ["burn_block_time"] as const,
		absent: ["timestamp"] as const,
	},
	{
		name: "both_time_keys",
		file: "new_block.both_time_keys.json",
		present: ["timestamp", "burn_block_time"] as const,
		absent: [] as const,
	},
] as const;

async function loadFixture(file: string): Promise<{
	fileBytes: Buffer;
	payload: NewBlockPayload;
}> {
	const url = new URL(`../test/fixtures/observer/${file}`, import.meta.url);
	const fileBytes = Buffer.from(await Bun.file(url).arrayBuffer());
	const payload = JSON.parse(fileBytes.toString("utf8")) as NewBlockPayload;
	return { fileBytes, payload };
}

describe("observer payload contract", () => {
	for (const fixture of FIXTURES) {
		test(`${fixture.name}: file bytes, time keys, parseBlock`, async () => {
			const { fileBytes, payload } = await loadFixture(fixture.file);

			expect(payload.index_block_hash).toMatch(HEX_LIKE);
			expect(payload.index_block_hash.length).toBeGreaterThan(2);

			const parsed = parseObserverBody<NewBlockPayload>(fileBytes);
			for (const key of fixture.present) {
				expect(key in parsed).toBe(true);
			}
			for (const key of fixture.absent) {
				expect(key in parsed).toBe(false);
			}

			expect(() => parseBlock(payload)).not.toThrow();
			const block = parseBlock(payload);
			expect(block.index_block_hash).toBe(payload.index_block_hash);
			expect(block.height).toBe(payload.block_height);
		});
	}

	test("`*` body omits vm_events", async () => {
		const { payload } = await loadFixture("new_block.star.json");
		expect("vm_events" in payload).toBe(false);
		expect(payload.events).toHaveLength(1);
		expect(payload.events[0]?.event_index).toBe(0);
	});

	test("opt-in empty array is present, not omitted", async () => {
		const { payload } = await loadFixture("new_block.vm_events.empty.json");
		expect("vm_events" in payload).toBe(true);
		expect(payload.vm_events).toEqual([]);
	});

	test("all five node types, sender null, array order", async () => {
		const { payload } = await loadFixture("new_block.vm_events.all_types.json");
		expect(payload.vm_events?.map((e) => e.type)).toEqual([
			"contract_call_event",
			"var_set_event",
			"map_insert_event",
			"map_set_event",
			"map_delete_event",
		]);
		expect(payload.vm_events?.[0]?.contract_call_event?.sender).toBeNull();
		for (const trace of payload.vm_events ?? []) {
			expect("event_index" in trace).toBe(false);
			expect("vm_event_index" in trace).toBe(false);
		}
	});

	test("`*` body omits state_writes and parses to no rows", async () => {
		const { payload } = await loadFixture("new_block.star.json");
		expect("state_writes" in payload).toBe(false);
		expect(
			parseStateWrites(payload.state_writes, payload.block_height),
		).toEqual([]);
	});

	test("opt-in empty state_writes is present, not omitted, and parses to no rows", async () => {
		const { payload } = await loadFixture("new_block.state_writes.empty.json");
		expect("state_writes" in payload).toBe(true);
		expect(payload.state_writes).toEqual([]);
		expect(
			parseStateWrites(payload.state_writes, payload.block_height),
		).toEqual([]);
	});

	test("opt-in state_writes keep node ordinal, full MARF key, and null tx_index for block-level writes", async () => {
		const { payload } = await loadFixture("new_block.state_writes.json");
		const rows = parseStateWrites(payload.state_writes, payload.block_height);
		expect(rows).toEqual(
			(payload.state_writes ?? []).map((w) => ({
				block_height: payload.block_height,
				ordinal: w.ordinal,
				tx_index: w.tx_index,
				key: w.key,
				value_hex: w.value_hex,
			})),
		);
		expect(rows[0]?.tx_index).toBeNull();
		expect(rows[0]?.key).toStartWith("vm-account::");
		expect(rows[1]?.tx_index).toBe(0);
		expect(rows[1]?.key).toStartWith("vm::");
	});

	test("malformed state_writes rows are skipped, not fatal", () => {
		const rows = parseStateWrites(
			[
				{ tx_index: 0, ordinal: 0, key: "vm::a", value_hex: "00" },
				{ tx_index: -1, ordinal: 1, key: "vm::b", value_hex: "00" },
				{ tx_index: null, ordinal: 2.5, key: "vm::c", value_hex: "00" },
				{ tx_index: null, ordinal: 3, key: "", value_hex: "00" },
				null as unknown as StateWritePayload,
				{ tx_index: null, ordinal: 5, key: "vm::f\0", value_hex: "00" },
				{ tx_index: null, ordinal: 6, key: "vm::g", value_hex: "00" },
			],
			7,
		);
		expect(rows.map((r) => r.ordinal)).toEqual([0, 6]);
	});

	test("opt-in body has vm_events with no event_index on traces", async () => {
		const { payload } = await loadFixture("new_block.vm_events.json");
		expect(payload.vm_events).toHaveLength(2);
		expect(payload.events[0]?.event_index).toBe(0);
		expect(payload.vm_events?.map((e) => e.type)).toEqual([
			"contract_call_event",
			"map_set_event",
		]);
		for (const trace of payload.vm_events ?? []) {
			expect("event_index" in trace).toBe(false);
			expect("vm_event_index" in trace).toBe(false);
		}
	});
});
