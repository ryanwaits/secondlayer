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
						indexes: [["tx_id"]],
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
		expect(result.schema.events).toMatchObject({
			indexes: [["tx_id"]],
		});
		expect(result.handlerCode).toContain("bundle-smoke");
	});

	test("rejects object-shaped indexes with a repair hint", async () => {
		await expect(
			bundleSubgraphCode(`
					import { defineSubgraph } from "@secondlayer/subgraphs";

					export default defineSubgraph({
						name: "bad-indexes",
						sources: {
							transfers: { type: "contract_call", contractId: "SP123.demo", functionName: "transfer" },
						},
						schema: {
							transfers: {
								columns: {
									sender: { type: "principal" },
									recipient: { type: "principal" },
								},
								indexes: [{ columns: ["sender"] }],
							},
						},
						handlers: {
							transfers: () => {},
						},
					});
				`),
		).rejects.toThrow(
			'Subgraph schema hint: use indexes: [["sender"], ["recipient"]], not indexes: [{ columns: ["sender"] }].',
		);
	});
});
