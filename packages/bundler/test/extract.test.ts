import { describe, expect, test } from "bun:test";
import {
	SubgraphNotStaticError,
	extractSubgraphDefinition,
} from "../src/extract.ts";

describe("extractSubgraphDefinition", () => {
	test("reads declarative metadata from a valid defineSubgraph({...}) call", () => {
		const result = extractSubgraphDefinition(`
			import { defineSubgraph } from "@secondlayer/subgraphs";

			export default defineSubgraph({
				name: "extract-smoke",
				version: "1.0.0",
				description: "smoke test",
				startBlock: 100,
				sources: {
					events: { type: "print_event", contractId: "SP123.demo" },
				},
				schema: {
					events: {
						columns: { tx_id: { type: "text" } },
					},
				},
				handlers: {
					events: (event, ctx) => {
						ctx.insert("events", { tx_id: event.tx.txId });
					},
				},
			});
		`);

		expect(result.name).toBe("extract-smoke");
		expect(result.version).toBe("1.0.0");
		expect(result.description).toBe("smoke test");
		expect(result.startBlock).toBe(100);
		expect(Object.keys(result.sources as Record<string, unknown>)).toEqual([
			"events",
		]);
		expect(Object.keys(result.schema as Record<string, unknown>)).toEqual([
			"events",
		]);
		expect(Object.keys(result.handlerSources)).toEqual(["events"]);
		expect(result.handlerSources.events).toContain("ctx.insert");
	});

	test("never executes a top-level side effect (security regression)", () => {
		(globalThis as Record<string, unknown>).__f059_pwned = undefined;
		extractSubgraphDefinition(`
			import { defineSubgraph } from "@secondlayer/subgraphs";
			;(globalThis as any).__f059_pwned = true;

			export default defineSubgraph({
				name: "pwned-attempt",
				sources: {
					events: { type: "print_event", contractId: "SP123.demo" },
				},
				schema: {
					events: { columns: { tx_id: { type: "text" } } },
				},
				handlers: {
					events: () => {},
				},
			});
		`);
		expect(
			(globalThis as Record<string, unknown>).__f059_pwned,
		).toBeUndefined();
	});

	test("converts bigint literals to real bigint (filter minAmount/maxAmount)", () => {
		const result = extractSubgraphDefinition(`
			import { defineSubgraph } from "@secondlayer/subgraphs";

			export default defineSubgraph({
				name: "bigint-filter",
				sources: {
					transfers: {
						type: "ft_transfer",
						assetIdentifier: "SP123.token::token",
						minAmount: 100n,
					},
				},
				schema: {
					transfers: { columns: { amount: { type: "uint" } } },
				},
				handlers: {},
			});
		`);
		const sources = result.sources as Record<string, { minAmount: unknown }>;
		expect(typeof sources.transfers.minAmount).toBe("bigint");
		expect(sources.transfers.minAmount).toBe(100n);
	});

	test("rejects a non-object-literal argument to defineSubgraph", () => {
		expect(() =>
			extractSubgraphDefinition(`
				import { defineSubgraph } from "@secondlayer/subgraphs";
				const config = { name: "dynamic", sources: {}, schema: {}, handlers: {} };
				export default defineSubgraph(config);
			`),
		).toThrow(SubgraphNotStaticError);
	});

	test("rejects a computed sources value", () => {
		expect(() =>
			extractSubgraphDefinition(`
				import { defineSubgraph } from "@secondlayer/subgraphs";
				function makeSources() { return {}; }
				export default defineSubgraph({
					name: "computed-sources",
					sources: makeSources(),
					schema: {},
					handlers: {},
				});
			`),
		).toThrow(SubgraphNotStaticError);
	});

	test("rejects zero defineSubgraph calls", () => {
		expect(() =>
			extractSubgraphDefinition(`
				export default { name: "no-call", sources: {}, schema: {}, handlers: {} };
			`),
		).toThrow(SubgraphNotStaticError);
	});

	test("rejects multiple defineSubgraph calls", () => {
		expect(() =>
			extractSubgraphDefinition(`
				import { defineSubgraph } from "@secondlayer/subgraphs";
				const a = defineSubgraph({ name: "a", sources: {}, schema: {}, handlers: {} });
				const b = defineSubgraph({ name: "b", sources: {}, schema: {}, handlers: {} });
				export default a;
			`),
		).toThrow(SubgraphNotStaticError);
	});

	test("finds the sole call in esbuild-bundled ESM output", () => {
		const result = extractSubgraphDefinition(`
			function defineSubgraph(def) { return def; }
			var x = defineSubgraph({
				name: "bundled-shape",
				sources: {
					events: { type: "print_event", contractId: "SP123.demo" },
				},
				schema: {
					events: { columns: { tx_id: { type: "text" } } },
				},
				handlers: {
					events: function(event, ctx) {},
				},
			});
			export { x as default };
		`);
		expect(result.name).toBe("bundled-shape");
		expect(Object.keys(result.sources as Record<string, unknown>)).toEqual([
			"events",
		]);
	});
});
