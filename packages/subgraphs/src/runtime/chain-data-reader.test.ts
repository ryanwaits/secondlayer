import { describe, expect, it } from "bun:test";
import type {
	IndexContractRow,
	IndexHttpClient,
} from "@secondlayer/shared/index-http";
import { hostedChainDataReader } from "./chain-data-reader.ts";

function registry(rows: { id: string; height: number }[]) {
	const state = { rows, fetches: 0 };
	const client = {
		listContractsByTrait: async (): Promise<IndexContractRow[]> => {
			state.fetches++;
			return state.rows.map((r) => ({
				contract_id: r.id,
				deployer: "SP1",
				block_height: r.height,
				declared_traits: ["sip-010"],
				inferred_standards: [],
				abi_status: "fetched",
			}));
		},
	} as unknown as IndexHttpClient;
	return { state, reader: hostedChainDataReader(client) };
}

describe("hosted trait membership", () => {
	it("answers as of the requested block from one fetch", async () => {
		const { state, reader } = registry([
			{ id: "SP1.old", height: 10 },
			{ id: "SP1.new", height: 500 },
		]);
		expect(await reader.traitContractIds("sip-010", 100)).toEqual(["SP1.old"]);
		expect(await reader.traitContractIds("sip-010", 500)).toEqual([
			"SP1.old",
			"SP1.new",
		]);
		// The first fetch already covered every height up to the newest deploy.
		expect(state.fetches).toBe(1);
	});

	it("refetches once the chain moves past what the cache covers", async () => {
		const { state, reader } = registry([{ id: "SP1.old", height: 10 }]);
		expect(await reader.traitContractIds("sip-010", 1000)).toEqual(["SP1.old"]);
		expect(await reader.traitContractIds("sip-010", 1000)).toEqual(["SP1.old"]);
		expect(state.fetches).toBe(1);

		state.rows.push({ id: "SP1.fresh", height: 1001 });
		expect(await reader.traitContractIds("sip-010", 1001)).toEqual([
			"SP1.old",
			"SP1.fresh",
		]);
		expect(state.fetches).toBe(2);
	});
});
