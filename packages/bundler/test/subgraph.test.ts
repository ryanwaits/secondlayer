import { describe, expect, test } from "bun:test";
import { bundleSubgraphCode } from "../src/subgraph.ts";

describe("bundleSubgraphCode", () => {
	test("bundles and evaluates a subgraph definition from a temp file", async () => {
		const result = await bundleSubgraphCode(`
			import { defineSubgraph } from "@secondlayer/subgraphs";

			export default defineSubgraph({
				name: "bundle-smoke",
				sources: {
					events: { type: "print_event", contractId: "SP123.demo" },
				},
				schema: {
					events: {
						columns: {
							tx_id: { type: "text" },
							amount: { type: "uint" },
						},
					},
				},
				handlers: {
					events: () => {},
				},
			});
		`);

		expect(result.name).toBe("bundle-smoke");
		expect(Object.keys(result.sources)).toEqual(["events"]);
		expect(Object.keys(result.schema)).toEqual(["events"]);
		expect(result.handlerCode).toContain("bundle-smoke");
	});
});
