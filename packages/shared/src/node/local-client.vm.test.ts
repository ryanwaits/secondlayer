import { describe, expect, test } from "bun:test";
import {
	VM_NODE_TO_STORED_TYPE,
	VM_STORED_TO_NODE_TYPE,
} from "../event-types.ts";
import { reconstructVmEventsForReplay } from "./local-client.ts";

describe("reconstructVmEventsForReplay", () => {
	test("emits node-shaped traces sorted into array order", () => {
		const reconstructed = reconstructVmEventsForReplay([
			{
				tx_id: "0xtx",
				ordinal: 3,
				type: "map_set",
				data: {
					contract_identifier: "SP.store",
					map_name: "store",
					raw_key: "0x0a",
					raw_value: "0x0b",
				},
			},
			{
				tx_id: "0xtx",
				ordinal: 0,
				type: "nested_contract_call",
				data: {
					contract_identifier: "SP.store",
					caller: "SP.c",
					function_name: "set-value",
					function_args: ["0x0d"],
					raw_result: "0x0703",
				},
			},
		]);
		expect(reconstructed.map((e) => e.type)).toEqual([
			"contract_call_event",
			"map_set_event",
		]);
		expect(reconstructed.every((e) => !("ordinal" in e))).toBe(true);
		expect(reconstructed[1]?.map_set_event).toEqual({
			contract_identifier: "SP.store",
			map_name: "store",
			raw_key: "0x0a",
			raw_value: "0x0b",
		});
		expect(reconstructed[0]?.contract_call_event).toMatchObject({
			function_name: "set-value",
		});
	});

	test("skips unknown stored types", () => {
		expect(
			reconstructVmEventsForReplay([
				{
					tx_id: "0xtx",
					ordinal: 1,
					type: "not-a-vm-type",
					data: {},
				},
			]),
		).toEqual([]);
	});

	test("stored→node is the inverse of node→stored", () => {
		for (const [node, stored] of Object.entries(VM_NODE_TO_STORED_TYPE) as [
			keyof typeof VM_NODE_TO_STORED_TYPE,
			(typeof VM_NODE_TO_STORED_TYPE)[keyof typeof VM_NODE_TO_STORED_TYPE],
		][]) {
			expect(VM_STORED_TO_NODE_TYPE[stored]).toBe(node);
		}
	});
});
