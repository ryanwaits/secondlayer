import { describe, expect, test } from "bun:test";
import { BundleSizeError, SUBGRAPH_SOURCE_MAX_BYTES } from "../src/errors.ts";
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

	test("rejects relative filesystem imports without bundling file content", async () => {
		await expect(
			bundleSubgraphCode(`
				import pkg from "./package.json";
				import { defineSubgraph } from "@secondlayer/subgraphs";

				export default defineSubgraph({
					name: "rel-import",
					sources: {
						events: {
							type: "print_event",
							contractId: "SP123.demo",
							prints: { event: { txId: "text" } },
						},
					},
					schema: {
						events: { columns: { tx_id: { type: "text" } } },
					},
					handlers: {
						events: () => {
							void pkg;
						},
					},
				});
			`),
		).rejects.toThrow(
			'Import "./package.json" is not allowed in single-file subgraph source; only "@secondlayer/subgraphs" may be imported',
		);
	});

	test("rejects absolute filesystem imports", async () => {
		await expect(
			bundleSubgraphCode(`
				import hosts from "/etc/hosts";
				import { defineSubgraph } from "@secondlayer/subgraphs";

				export default defineSubgraph({
					name: "abs-import",
					sources: {
						events: {
							type: "print_event",
							contractId: "SP123.demo",
							prints: { event: { txId: "text" } },
						},
					},
					schema: {
						events: { columns: { tx_id: { type: "text" } } },
					},
					handlers: {
						events: () => {
							void hosts;
						},
					},
				});
			`),
		).rejects.toThrow(
			'Import "/etc/hosts" is not allowed in single-file subgraph source; only "@secondlayer/subgraphs" may be imported',
		);
	});

	test("rejects node builtin and third-party imports", async () => {
		await expect(
			bundleSubgraphCode(`
				import fs from "node:fs";
				import { defineSubgraph } from "@secondlayer/subgraphs";

				export default defineSubgraph({
					name: "builtin-import",
					sources: {
						events: {
							type: "print_event",
							contractId: "SP123.demo",
							prints: { event: { txId: "text" } },
						},
					},
					schema: {
						events: { columns: { tx_id: { type: "text" } } },
					},
					handlers: {
						events: () => {
							void fs;
						},
					},
				});
			`),
		).rejects.toThrow(
			'Import "node:fs" is not allowed in single-file subgraph source; only "@secondlayer/subgraphs" may be imported',
		);
	});

	test("allows type-only and runtime imports from @secondlayer/subgraphs", async () => {
		const result = await bundleSubgraphCode(`
			import type { SubgraphDefinition } from "@secondlayer/subgraphs";
			import { defineSubgraph, readContractAt } from "@secondlayer/subgraphs";

			const ABI = {
				functions: [{
					name: "get-total",
					access: "read-only",
					args: [],
					outputs: "uint128",
				}],
			} as const;

			const def: SubgraphDefinition = defineSubgraph({
				name: "allowed-imports",
				sources: {
					transfer: { type: "ft_transfer", assetIdentifier: "SP123.token::token" },
				},
				schema: {
					totals: { columns: { total: { type: "uint" } } },
				},
				handlers: {
					transfer: async (_event, ctx) => {
						const contract = readContractAt(ctx, "SP123.token", ABI);
						const total = await contract.read.getTotal({});
						ctx.insert("totals", { total });
					},
				},
			});

			export default def;
		`);

		expect(result.name).toBe("allowed-imports");
		expect(result.handlerCode).toContain("allowed-imports");
	});

	test("throws BundleSizeError without invoking esbuild when source exceeds SUBGRAPH_SOURCE_MAX_BYTES", async () => {
		const oversized = `@@@invalid syntax@@@${"a".repeat(SUBGRAPH_SOURCE_MAX_BYTES)}`;
		let caught: unknown;
		try {
			await bundleSubgraphCode(oversized);
		} catch (err) {
			caught = err;
		}
		expect(caught).toBeInstanceOf(BundleSizeError);
		const sizeErr = caught as BundleSizeError;
		expect(sizeErr.actualBytes).toBe(Buffer.byteLength(oversized, "utf8"));
		expect(sizeErr.maxBytes).toBe(SUBGRAPH_SOURCE_MAX_BYTES);
	});
});
