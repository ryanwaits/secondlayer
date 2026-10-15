import { describe, expect, test } from "bun:test";
import {
	Cl,
	type ClarityValue,
	serializeCV,
} from "@secondlayer/stacks/clarity";
import type { SubgraphFilter } from "../types.ts";
import { buildEventPayload } from "./runner.ts";
import type { MatchedTx } from "./source-matcher.ts";

const tx = {
	tx_id: "0xabc",
	type: "contract_call",
	sender: "SP000000000000000000002Q6VF78",
	status: "success",
	contract_id: null,
	function_name: null,
	function_args: [],
	raw_result: null,
} as unknown as MatchedTx["tx"];

const POOL = "SP21G4FA7NS9YXEH2B4X8B642ZSVP7J8RB6DEVK2Y";
const hex = (cv: ClarityValue) => `0x${serializeCV(cv)}`;

const abi = {
	functions: [],
	maps: [
		{ name: "reserve", key: "principal", value: "uint128" },
		{
			name: "positions",
			key: { tuple: [{ name: "pool-id", type: "uint128" }] },
			value: {
				tuple: [
					{ name: "last-updated", type: "uint128" },
					{ name: "owner", type: { optional: "principal" } },
					{
						name: "result",
						type: { response: { ok: "uint128", error: "uint128" } },
					},
					{ name: "history", type: { list: { type: "uint128", length: 5 } } },
				],
			},
		},
	],
	variables: [
		{ name: "total", type: "uint128", access: "variable" },
		{ name: "admin", type: { optional: "principal" }, access: "variable" },
	],
} as unknown as NonNullable<
	Extract<SubgraphFilter, { type: "map_set" }>["abi"]
>;

function vmEvent(
	type: string,
	data: Record<string, unknown>,
): MatchedTx["events"][0] {
	return {
		type,
		event_index: 0,
		tx_id: tx.tx_id,
		id: "vm",
		data: { contract_identifier: "SP.store", ...data },
	} as unknown as MatchedTx["events"][0];
}

const positionValue = (owner: ClarityValue, result: ClarityValue) =>
	hex(
		Cl.tuple({
			"last-updated": Cl.uint(9),
			owner,
			result,
			history: Cl.list([Cl.uint(1), Cl.uint(2)]),
		}),
	);

describe("state-write payloads decode with the source abi", () => {
	test("map_set principal key and uint value", () => {
		const payload = buildEventPayload(
			{ type: "map_set", map: "reserve", abi } as SubgraphFilter,
			tx,
			vmEvent("map_set", {
				map_name: "reserve",
				raw_key: hex(Cl.standardPrincipal(POOL)),
				raw_value: hex(Cl.uint(42)),
			}),
		);
		expect(payload.key).toBe(POOL);
		expect(payload.value).toBe(42n);
	});

	test("tuple key and value use camelCase keys, optionals, responses and lists", () => {
		const payload = buildEventPayload(
			{ type: "map_insert", map: "positions", abi } as SubgraphFilter,
			tx,
			vmEvent("map_insert", {
				map_name: "positions",
				raw_key: hex(Cl.tuple({ "pool-id": Cl.uint(7) })),
				raw_value: positionValue(
					Cl.some(Cl.standardPrincipal(POOL)),
					Cl.ok(Cl.uint(3)),
				),
			}),
		);
		expect(payload.key).toEqual({ poolId: 7n });
		expect(payload.value).toEqual({
			lastUpdated: 9n,
			owner: POOL,
			result: { ok: 3n },
			history: [1n, 2n],
		});
	});

	test("none decodes to null and err keeps its wrapper", () => {
		const payload = buildEventPayload(
			{ type: "map_set", map: "positions", abi } as SubgraphFilter,
			tx,
			vmEvent("map_set", {
				map_name: "positions",
				raw_key: hex(Cl.tuple({ "pool-id": Cl.uint(7) })),
				raw_value: positionValue(Cl.none(), Cl.error(Cl.uint(5))),
			}),
		);
		expect((payload.value as { owner: unknown }).owner).toBeNull();
		expect((payload.value as { result: unknown }).result).toEqual({ err: 5n });
	});

	test("map_delete decodes its key", () => {
		const payload = buildEventPayload(
			{ type: "map_delete", map: "reserve", abi } as SubgraphFilter,
			tx,
			vmEvent("map_delete", {
				map_name: "reserve",
				raw_key: hex(Cl.standardPrincipal(POOL)),
			}),
		);
		expect(payload.key).toBe(POOL);
	});

	test("var_set decodes its value from the variable type", () => {
		const filter = { type: "var_set", varName: "admin", abi } as SubgraphFilter;
		const some = buildEventPayload(
			filter,
			tx,
			vmEvent("var_set", {
				var_name: "admin",
				raw_value: hex(Cl.some(Cl.standardPrincipal(POOL))),
			}),
		);
		expect(some.value).toBe(POOL);
		const none = buildEventPayload(
			filter,
			tx,
			vmEvent("var_set", { var_name: "admin", raw_value: hex(Cl.none()) }),
		);
		expect(none.value).toBeNull();
	});

	test("raw hex stays untouched alongside the decoded value", () => {
		const raw = hex(Cl.uint(42));
		const payload = buildEventPayload(
			{ type: "map_set", map: "reserve", abi } as SubgraphFilter,
			tx,
			vmEvent("map_set", {
				map_name: "reserve",
				raw_key: hex(Cl.standardPrincipal(POOL)),
				raw_value: raw,
			}),
		);
		expect(payload.rawValue).toBe(raw);
	});
});

describe("state-write payloads without a usable abi keep untyped decoding", () => {
	const event = vmEvent("map_set", {
		map_name: "positions",
		raw_key: hex(Cl.tuple({ "pool-id": Cl.uint(7) })),
		raw_value: hex(Cl.some(Cl.uint(3))),
	});

	test("no abi: kebab-case tuple keys and unwrapped optionals, as before", () => {
		const payload = buildEventPayload(
			{ type: "map_set", map: "positions" } as SubgraphFilter,
			tx,
			event,
		);
		expect(payload.key).toEqual({ "pool-id": 7n });
		expect(payload.value).toBe(3n);
	});

	test("abi without the map: untyped decoding", () => {
		const payload = buildEventPayload(
			{ type: "map_set", map: "missing", abi } as SubgraphFilter,
			tx,
			vmEvent("map_set", { ...(event.data as object), map_name: "missing" }),
		);
		expect(payload.key).toEqual({ "pool-id": 7n });
		expect(payload.value).toBe(3n);
	});

	test("abi type that does not match the stored value falls back to untyped", () => {
		const payload = buildEventPayload(
			{ type: "map_set", map: "reserve", abi } as SubgraphFilter,
			tx,
			vmEvent("map_set", {
				map_name: "reserve",
				raw_key: hex(Cl.uint(1)),
				raw_value: hex(Cl.uint(2)),
			}),
		);
		expect(payload.key).toBe(1n);
		expect(payload.value).toBe(2n);
	});
});
