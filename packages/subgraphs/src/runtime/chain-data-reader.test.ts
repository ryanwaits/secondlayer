import { describe, expect, it } from "bun:test";
import type {
	IndexContractRow,
	IndexHttpClient,
} from "@secondlayer/shared/index-http";
import { hostedChainDataReader } from "./chain-data-reader.ts";

type Row = { id: string; height: number; classifiedAt: number };

function registry(rows: Row[]) {
	const state = {
		rows,
		fetches: 0,
		calls: [] as ({ classifiedAfter?: Date } | undefined)[],
		clock: 1_000_000,
	};
	const client = {
		listContractsByTrait: async (
			_trait: string,
			opts?: { classifiedAfter?: Date },
		): Promise<IndexContractRow[]> => {
			state.fetches++;
			state.calls.push(opts);
			const since = opts?.classifiedAfter?.getTime();
			return state.rows
				.filter((r) => since === undefined || r.classifiedAt >= since)
				.map((r) => ({
					contract_id: r.id,
					deployer: "SP1",
					block_height: r.height,
					declared_traits: ["sip-010"],
					inferred_standards: [],
					abi_status: "fetched",
					classified_at: new Date(r.classifiedAt).toISOString(),
				}));
		},
	} as unknown as IndexHttpClient;
	return {
		state,
		reader: hostedChainDataReader(client, { now: () => state.clock }),
	};
}

describe("hosted trait membership", () => {
	it("answers as of the requested block from one fetch", async () => {
		const { state, reader } = registry([
			{ id: "SP1.old", height: 10, classifiedAt: 1_000 },
			{ id: "SP1.new", height: 500, classifiedAt: 1_000 },
		]);
		expect(await reader.traitContractIds("sip-010", 100)).toEqual(["SP1.old"]);
		expect(await reader.traitContractIds("sip-010", 500)).toEqual([
			"SP1.old",
			"SP1.new",
		]);
		expect(state.fetches).toBe(1);
	});

	it("after the first walk, a new block asks only for changes", async () => {
		const { state, reader } = registry([
			{ id: "SP1.old", height: 10, classifiedAt: 1_000 },
		]);
		expect(await reader.traitContractIds("sip-010", 1000)).toEqual(["SP1.old"]);
		expect(state.calls[0]).toBeUndefined();

		state.rows.push({ id: "SP1.fresh", height: 1001, classifiedAt: 2_000 });
		state.clock += 6_000;
		expect(await reader.traitContractIds("sip-010", 1001)).toEqual([
			"SP1.old",
			"SP1.fresh",
		]);
		expect(state.fetches).toBe(2);
		expect(state.calls[1]?.classifiedAfter).toBeInstanceOf(Date);
	});

	it("one block asked twice fetches once", async () => {
		const { state, reader } = registry([
			{ id: "SP1.old", height: 10, classifiedAt: 1_000 },
		]);
		await reader.traitContractIds("sip-010", 1000);
		state.clock += 6_000;
		await reader.traitContractIds("sip-010", 1001);
		await reader.traitContractIds("sip-010", 1001);
		expect(state.fetches).toBe(2);
	});

	it("refreshes at most every 5 seconds", async () => {
		const { state, reader } = registry([
			{ id: "SP1.old", height: 10, classifiedAt: 1_000 },
		]);
		await reader.traitContractIds("sip-010", 1000);
		for (const block of [1001, 1002, 1003]) {
			state.clock += 1_000;
			await reader.traitContractIds("sip-010", block);
		}
		expect(state.fetches).toBe(1);

		state.clock += 2_000;
		await reader.traitContractIds("sip-010", 1004);
		expect(state.fetches).toBe(2);
	});

	it("a contract classified after its deploy block still joins", async () => {
		const { state, reader } = registry([
			{ id: "SP1.old", height: 10, classifiedAt: 1_000 },
		]);
		expect(await reader.traitContractIds("sip-010", 950)).toEqual(["SP1.old"]);

		state.rows.push({ id: "SP1.late", height: 900, classifiedAt: 5_000 });
		state.clock += 6_000;
		expect(await reader.traitContractIds("sip-010", 1000)).toEqual([
			"SP1.old",
			"SP1.late",
		]);
	});

	it("answers older blocks from the cache without fetching", async () => {
		const { state, reader } = registry([
			{ id: "SP1.old", height: 10, classifiedAt: 1_000 },
			{ id: "SP1.new", height: 500, classifiedAt: 1_000 },
		]);
		await reader.traitContractIds("sip-010", 1000);
		state.clock += 60_000;
		expect(await reader.traitContractIds("sip-010", 100)).toEqual(["SP1.old"]);
		expect(state.fetches).toBe(1);
	});
});
