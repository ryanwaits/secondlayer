import { describe, expect, test } from "bun:test";
import { SecondLayer } from "../client.ts";
import { Subgraphs } from "../subgraphs/client.ts";
import { getSubgraph } from "../subgraphs/get-subgraph.ts";

const mockSchema = {
	name: "test-subgraph",
	schema: {
		transfers: {
			columns: {
				sender: { type: "principal" as const },
				amount: { type: "uint" as const },
			},
		},
		holders: {
			columns: {
				address: { type: "principal" as const },
			},
		},
	},
} as const;

describe("getSubgraph", () => {
	test("plain options object — returns client with schema table keys", () => {
		const client = getSubgraph(mockSchema, { apiKey: "sl_test" });
		expect(typeof client.transfers.findMany).toBe("function");
		expect(typeof client.transfers.count).toBe("function");
		expect(typeof client.holders.findMany).toBe("function");
	});

	test("SecondLayer instance — delegates to subgraphs.typed()", () => {
		const sl = new SecondLayer({ apiKey: "sl_test" });
		const client = getSubgraph(mockSchema, sl);
		expect(typeof client.transfers.findMany).toBe("function");
		expect(typeof client.holders.findMany).toBe("function");
	});

	test("Subgraphs instance — delegates to typed() directly", () => {
		const subgraphs = new Subgraphs({ apiKey: "sl_test" });
		const client = getSubgraph(mockSchema, subgraphs);
		expect(typeof client.transfers.findMany).toBe("function");
		expect(typeof client.holders.findMany).toBe("function");
	});

	test("no options — uses defaults", () => {
		const client = getSubgraph(mockSchema);
		expect(typeof client.transfers.findMany).toBe("function");
	});

	test("all three paths produce identical key sets", () => {
		const fromPlain = getSubgraph(mockSchema, {});
		const fromSL = getSubgraph(mockSchema, new SecondLayer({}));
		const fromSubgraphs = getSubgraph(mockSchema, new Subgraphs({}));
		const keys = Object.keys(mockSchema.schema).sort();
		expect(Object.keys(fromPlain).sort()).toEqual(keys);
		expect(Object.keys(fromSL).sort()).toEqual(keys);
		expect(Object.keys(fromSubgraphs).sort()).toEqual(keys);
	});
});
