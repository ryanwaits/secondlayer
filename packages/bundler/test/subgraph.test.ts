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

	test("never executes a top-level side effect in the source (f059 regression)", async () => {
		(globalThis as Record<string, unknown>).__f059_bundle_pwned = undefined;
		const result = await bundleSubgraphCode(`
				import { defineSubgraph } from "@secondlayer/subgraphs";
				;(globalThis as any).__f059_bundle_pwned = true;

				export default defineSubgraph({
					name: "bundle-side-effect",
					sources: {
						events: { type: "print_event", contractId: "SP123.demo" },
					},
					schema: {
						events: {
							columns: { tx_id: { type: "text" } },
						},
					},
					handlers: {
						events: () => {},
					},
				});
			`);

		expect(result.name).toBe("bundle-side-effect");
		expect(
			(globalThis as Record<string, unknown>).__f059_bundle_pwned,
		).toBeUndefined();
	});
});
