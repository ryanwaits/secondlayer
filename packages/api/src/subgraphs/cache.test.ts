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

	it("a slow older refresh never overwrites a newer snapshot", async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let call = 0;
		const cache = new SubgraphRegistryCache(async () => {
			call += 1;
			if (call === 1) {
				await gate;
				return [sg({ name: "old" })];
			}
			return [sg({ name: "new" })];
		});

		const slow = cache.refresh();
		await cache.refresh();
		release();
		await slow;

		expect(cache.getAll().map((s) => s.name)).toEqual(["new"]);
	});

	it("a failed refresh leaves the last good snapshot in place", async () => {
		let fail = false;
		const cache = new SubgraphRegistryCache(async () => {
			if (fail) throw new Error("db down");
			return [sg({ name: "kept" })];
		});
		await cache.refresh();
		fail = true;
		await expect(cache.refresh()).rejects.toThrow("db down");
		expect(cache.getAll().map((s) => s.name)).toEqual(["kept"]);
	});
});
