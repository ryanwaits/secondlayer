import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Subgraph } from "@secondlayer/shared/db";
import {
	handlerCacheKey,
	loadSubgraphDefinition,
} from "../src/runtime/processor.ts";

const bundle = (description: string) => `
function defineSubgraph(d) { return d; }
var subgraph_default = defineSubgraph({
	name: "cache-demo",
	description: ${JSON.stringify(description)},
	sources: { s: { type: "stx_transfer" } },
	schema: { rows: { columns: { v: { type: "text" } } } },
	handlers: { s: () => {} },
});
export { subgraph_default as default };
`;

const dir = mkdtempSync(join(tmpdir(), "sg-cache-"));
const row = (
	handlerCode: string,
	bust: number,
	overrides: Partial<Subgraph> = {},
): Subgraph =>
	({
		name: "cache-demo",
		version: "1.0.0",
		handler_code: handlerCode,
		// Same path on every deploy: a stored bundle never loads from disk.
		handler_path: join(dir, `cache-demo.${bust}.js`),
		pin: null,
		verification: null,
		...overrides,
	}) as Subgraph;

describe("processor handler cache", () => {
	test("a handler-only redeploy reloads without a restart, though the version is unchanged", async () => {
		const first = await loadSubgraphDefinition(row(bundle("v1"), 1));
		expect(first.description).toBe("v1");

		// Same row again: served from cache.
		expect(await loadSubgraphDefinition(row(bundle("v1"), 1))).toBe(first);

		// handler_updated keeps version 1.0.0; the content changed.
		const second = await loadSubgraphDefinition(row(bundle("v2"), 1));
		expect(second.description).toBe("v2");
	});

	test("the key follows content: pin first, else the stored bundle, else version and path", () => {
		const a = row(bundle("a"), 1);
		expect(handlerCacheKey(a)).toBe(
			handlerCacheKey({ ...a, version: "9.9.9" }),
		);
		expect(handlerCacheKey(a)).not.toBe(handlerCacheKey(row(bundle("b"), 1)));
		expect(handlerCacheKey({ ...a, pin: "p1" })).not.toBe(
			handlerCacheKey({ ...a, pin: "p2" }),
		);
		const local = row("", 1, { handler_code: null });
		expect(handlerCacheKey(local)).not.toBe(
			handlerCacheKey({ ...local, version: "1.0.1" }),
		);
		// Becoming state-level switches the loading path, so it reloads too.
		expect(handlerCacheKey(a)).not.toBe(
			handlerCacheKey({
				...a,
				verification: {
					level: "state",
					reasons: [],
					unproven: [],
				},
			}),
		);
	});
});
