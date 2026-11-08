import { describe, expect, it } from "bun:test";
import type { Subgraph } from "@secondlayer/shared/db";
import postgres from "postgres";
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

	it("reloads on a TTL even when no notification arrives", async () => {
		let version = "a";
		const cache = new SubgraphRegistryCache(
			async () => [sg({ name: version })],
			20,
		);
		await cache.start();
		expect(cache.getAll().map((s) => s.name)).toEqual(["a"]);
		version = "b";
		await Bun.sleep(80);
		await cache.stop();
		expect(cache.getAll().map((s) => s.name)).toEqual(["b"]);
	});

	it("refreshQuietly swallows a failed load and keeps the snapshot", async () => {
		let fail = false;
		const cache = new SubgraphRegistryCache(async () => {
			if (fail) throw new Error("db down");
			return [sg({ name: "kept" })];
		});
		await cache.refresh();
		fail = true;
		await cache.refreshQuietly();
		expect(cache.getAll().map((s) => s.name)).toEqual(["kept"]);
	});

	it.skipIf(!process.env.DATABASE_URL)(
		"reloads when the LISTEN connection drops and comes back",
		async () => {
			const admin = postgres(process.env.DATABASE_URL as string, { max: 1 });
			let loads = 0;
			const cache = new SubgraphRegistryCache(async () => {
				loads += 1;
				return [sg({ name: `load-${loads}` })];
			}, 60_000);
			try {
				await cache.start();
				await Bun.sleep(100);
				const before = loads;
				await admin`
					SELECT pg_terminate_backend(pid) FROM pg_stat_activity
					WHERE query ILIKE 'listen%subgraph_changes%'
						AND pid <> pg_backend_pid()
				`;
				const deadline = Date.now() + 5_000;
				while (loads === before && Date.now() < deadline) await Bun.sleep(50);
				expect(loads).toBeGreaterThan(before);
			} finally {
				await cache.stop();
				await admin.end();
			}
		},
	);
});
