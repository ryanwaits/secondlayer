import { describe, expect, test } from "bun:test";
import { bundleSubgraphCode } from "../src/subgraph.ts";

describe("bundleSubgraphCode", () => {
	test("bundles and evaluates a subgraph definition from a temp file", async () => {
		const result = await bundleSubgraphCode(`
			import { defineSubgraph } from "@secondlayer/subgraphs";

			export default defineSubgraph({
				name: "bundle-smoke",
				sources: {
					events: {
						type: "print_event",
						contractId: "SP123.demo",
						prints: { event: { amount: "uint" } },
					},
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
							transfers: {
								type: "contract_call",
								contractId: "SP123.demo",
								functionName: "transfer",
								abi: {
									functions: [{
										name: "transfer",
										access: "public",
										args: [],
										outputs: "bool",
									}],
								},
							},
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
						events: {
							type: "print_event",
							contractId: "SP123.demo",
							prints: { event: { txId: "text" } },
						},
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
	test("bundles a handler that imports readContractAt and reports a ctx.client finding", async () => {
		const result = await bundleSubgraphCode(`
				import { defineSubgraph, readContractAt } from "@secondlayer/subgraphs";

				const SIP010 = {
					functions: [{
						name: "get-decimals",
						access: "read-only",
						args: [],
						outputs: { response: { ok: "uint128", error: "uint128" } },
					}],
				} as const;

				export default defineSubgraph({
					name: "bundle-chain-read",
					sources: {
						transfer: { type: "ft_transfer", assetIdentifier: "SP123.token::token" },
					},
					schema: {
						transfers: {
							columns: { decimals: { type: "uint" } },
						},
					},
					handlers: {
						transfer: async (event, ctx) => {
							const token = readContractAt(ctx, "SP123.token", SIP010, {
								cache: "contract-constant",
							});
							const decimals = await token.read.getDecimals({});
							ctx.insert("transfers", { decimals });
						},
					},
				});
			`);

		expect(result.name).toBe("bundle-chain-read");
		expect(result.findings.map((f) => `${f.kind}:${f.name}`)).toContain(
			"needs-events:ctx.client",
		);
	});
});
