import { describe, expect, test } from "bun:test";
import type { SubgraphDefinition } from "@secondlayer/subgraphs";
import { applyDeployStartBlockOverride } from "../src/routes/subgraphs.ts";

const def = {
	name: "demo-subgraph",
	startBlock: 10,
	sources: {
		events: { type: "print_event", contractId: "SP123.demo", topic: "event" },
	},
	schema: {
		events: {
			columns: {
				sender: { type: "principal" },
			},
		},
	},
	handlers: {
		events: () => {},
	},
} as unknown as SubgraphDefinition;

describe("subgraph deploy helpers", () => {
	test("overrides imported definition startBlock when request provides one", () => {
		const overridden = applyDeployStartBlockOverride(def, 123);
		expect(overridden).not.toBe(def);
		expect(overridden.startBlock).toBe(123);
		expect(def.startBlock).toBe(10);
	});

	test("keeps imported definition unchanged without request startBlock", () => {
		expect(applyDeployStartBlockOverride(def)).toBe(def);
	});
});
