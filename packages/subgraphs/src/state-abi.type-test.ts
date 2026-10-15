/**
 * Type-level tests: a state-write source with a declared `abi` types `key` and
 * `value` from the contract's map/variable definition; without one (or with a
 * name the abi lacks) they stay `unknown`. Type-checked by `tsc`, never run.
 */
import { expectTypeOf } from "expect-type";
import { defineSubgraph } from "./define.ts";

const storeAbi = {
	functions: [],
	maps: [
		{ name: "reserve", key: "principal", value: "uint128" },
		{
			name: "positions",
			key: { tuple: [{ name: "pool-id", type: "uint128" }] },
			value: { tuple: [{ name: "last-updated", type: "uint128" }] },
		},
	],
	variables: [
		{ name: "total", type: "uint128", access: "variable" },
		{ name: "admin", type: { optional: "principal" }, access: "variable" },
	],
} as const;

defineSubgraph({
	name: "state-abi-type-test",
	sources: {
		reserve: {
			type: "map_set",
			contractId: "SP.store",
			map: "reserve",
			abi: storeAbi,
		},
		positions: {
			type: "map_insert",
			contractId: "SP.store",
			map: "positions",
			abi: storeAbi,
		},
		gone: {
			type: "map_delete",
			contractId: "SP.store",
			map: "reserve",
			abi: storeAbi,
		},
		total: {
			type: "var_set",
			contractId: "SP.store",
			varName: "total",
			abi: storeAbi,
		},
		admin: {
			type: "var_set",
			contractId: "SP.store",
			varName: "admin",
			abi: storeAbi,
		},
		noAbi: { type: "map_set", contractId: "SP.store", map: "reserve" },
		unknownMap: {
			type: "map_set",
			contractId: "SP.store",
			map: "missing",
			abi: storeAbi,
		},
		unknownVar: {
			type: "var_set",
			contractId: "SP.store",
			varName: "missing",
			abi: storeAbi,
		},
	},
	schema: { rows: { columns: { k: { type: "text" } } } },
	handlers: {
		reserve: (event) => {
			expectTypeOf(event.key).toEqualTypeOf<string>();
			expectTypeOf(event.value).toEqualTypeOf<bigint>();
			// @ts-expect-error a uint128 value has no members
			void event.value.lastUpdated;
		},
		positions: (event) => {
			expectTypeOf(event.key).toEqualTypeOf<{ poolId: bigint }>();
			expectTypeOf(event.value).toEqualTypeOf<{ lastUpdated: bigint }>();
		},
		gone: (event) => {
			expectTypeOf(event.key).toEqualTypeOf<string>();
			// @ts-expect-error map_delete carries no value
			void event.value;
		},
		total: (event) => {
			expectTypeOf(event.value).toEqualTypeOf<bigint>();
		},
		admin: (event) => {
			expectTypeOf(event.value).toEqualTypeOf<string | null>();
		},
		noAbi: (event) => {
			expectTypeOf(event.key).toEqualTypeOf<unknown>();
			expectTypeOf(event.value).toEqualTypeOf<unknown>();
		},
		unknownMap: (event) => {
			expectTypeOf(event.key).toEqualTypeOf<unknown>();
			expectTypeOf(event.value).toEqualTypeOf<unknown>();
		},
		unknownVar: (event) => {
			expectTypeOf(event.value).toEqualTypeOf<unknown>();
		},
	},
});
