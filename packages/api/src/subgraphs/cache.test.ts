import { describe, expect, it } from "bun:test";
import type { Subgraph } from "@secondlayer/shared/db";
import { SubgraphRegistryCache } from "./cache.ts";

function sg(overrides: Partial<Subgraph>): Subgraph {
	return {
		id: "id",
		name: "name",
		version: "1.0.0",
		status: "synced",
		definition: {},
		schema_hash: "hash",
		handler_path: "/tmp/h.js",
		schema_name: null,
		start_block: 0,
		last_processed_block: 0,
		reindex_from_block: null,
		reindex_to_block: null,
		last_error: null,
		last_error_at: null,
		total_processed: 0,
		total_errors: 0,
		account_id: "",
		handler_code: null,
		source_code: null,
		project_id: null,
		created_at: new Date(),
		updated_at: new Date(),
		...overrides,
	} as Subgraph;
}

describe("SubgraphRegistryCache", () => {
	it("keys get and getAll by name", async () => {
		const cache = new SubgraphRegistryCache(async () => [
			sg({ name: "closed", account_id: "acct-a" }),
		]);
		await cache.refresh();
		expect(cache.get("closed")?.name).toBe("closed");
		expect(cache.get("missing")).toBeUndefined();
		expect(cache.getAll().map((s) => s.name)).toEqual(["closed"]);
	});
});
