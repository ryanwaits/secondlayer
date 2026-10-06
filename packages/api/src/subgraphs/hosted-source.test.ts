import { describe, expect, test } from "bun:test";
import { findUnhostableSource, hasNoLocalChain } from "./hosted-source.ts";

describe("hasNoLocalChain", () => {
	test("false without a hosted index URL, never reads progress", async () => {
		let reads = 0;
		const result = await hasNoLocalChain({
			env: {},
			hasProgressRow: async () => {
				reads++;
				return false;
			},
		});
		expect(result).toBe(false);
		expect(reads).toBe(0);
	});

	test("false when the hosted URL is set but a local indexer has a progress row", async () => {
		const result = await hasNoLocalChain({
			env: { SUBGRAPH_INDEX_API_URL: "https://api.example" },
			hasProgressRow: async () => true,
		});
		expect(result).toBe(false);
	});

	test("true when the hosted URL is set and there is no progress row for the network", async () => {
		const networks: string[] = [];
		const result = await hasNoLocalChain({
			env: {
				SUBGRAPH_INDEX_API_URL: "https://api.example",
				NETWORK: "testnet",
			},
			hasProgressRow: async (network) => {
				networks.push(network);
				return false;
			},
		});
		expect(result).toBe(true);
		expect(networks).toEqual(["testnet"]);
	});
});

describe("findUnhostableSource", () => {
	test("null when every source is an event or tx filter", () => {
		expect(
			findUnhostableSource({
				sources: {
					transfers: { type: "ft_transfer" },
					calls: { type: "contract_call", contractId: "SP1.c" },
				},
			} as never),
		).toBeNull();
	});

	test("names the first source that would fall to the local tap", () => {
		expect(
			findUnhostableSource({
				sources: {
					transfers: { type: "ft_transfer" },
					mystery: { type: "not_a_known_filter" },
				},
			} as never),
		).toBe("mystery");
	});

	test("array-style sources are refused", () => {
		expect(
			findUnhostableSource({
				sources: [{ type: "ft_transfer" }],
			} as never),
		).toBe("sources");
	});
});
