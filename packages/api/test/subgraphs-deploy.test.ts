import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { SubgraphDefinition } from "@secondlayer/subgraphs";
import {
	applyDeployStartBlockOverride,
	handlerImportUrl,
	hasDeployStartBlockChanged,
	resolveDeployStartBlock,
} from "../src/routes/subgraphs.ts";

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

	test("resolves deploy start block defaults and explicit zero", () => {
		expect(resolveDeployStartBlock({ ...def, startBlock: undefined })).toBe(1);
		expect(resolveDeployStartBlock({ ...def, startBlock: 0 })).toBe(0);
	});

	test("detects start-block-only redeploys as reindex-worthy", () => {
		expect(
			hasDeployStartBlockChanged({
				existingStartBlock: 1,
				definitionStartBlock: 7799262,
			}),
		).toBe(true);
		expect(
			hasDeployStartBlockChanged({
				existingStartBlock: 7799262,
				definitionStartBlock: 7799262,
			}),
		).toBe(false);
		expect(
			hasDeployStartBlockChanged({
				existingStartBlock: 1,
				definitionStartBlock: undefined,
			}),
		).toBe(false);
	});

	test("builds file URLs for relative handler imports", () => {
		const handlerPath = "data/subgraphs/sbtc-activity.js";
		expect(handlerImportUrl(handlerPath, 123)).toBe(
			`${pathToFileURL(resolve(handlerPath)).href}?t=123`,
		);
	});
});
