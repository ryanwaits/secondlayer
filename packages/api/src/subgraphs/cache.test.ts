import { afterEach, beforeEach, describe, expect, it } from "bun:test";
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
		visibility: "private",
		database_url_enc: null,
		created_at: new Date(),
		updated_at: new Date(),
		...overrides,
	} as Subgraph;
}

describe("SubgraphRegistryCache visibility resolution (platform mode)", () => {
	let prevMode: string | undefined;

	beforeEach(() => {
		prevMode = process.env.INSTANCE_MODE;
		process.env.INSTANCE_MODE = "platform";
	});

	afterEach(() => {
		if (prevMode === undefined) process.env.INSTANCE_MODE = undefined;
		else process.env.INSTANCE_MODE = prevMode;
	});

	async function load(subgraphs: Subgraph[]): Promise<SubgraphRegistryCache> {
		const cache = new SubgraphRegistryCache(async () => subgraphs);
		await cache.refresh();
		return cache;
	}

	it("getPublicByName resolves only public subgraphs, across accounts", async () => {
		const cache = await load([
			sg({ name: "open", account_id: "acct-a", visibility: "public" }),
			sg({ name: "closed", account_id: "acct-a", visibility: "private" }),
		]);
		expect(cache.getPublicByName("open")?.account_id).toBe("acct-a");
		// Private subgraphs never resolve by name alone — anon reads 404.
		expect(cache.getPublicByName("closed")).toBeUndefined();
		expect(cache.getPublicByName("missing")).toBeUndefined();
	});

	it("owner resolution still works for private subgraphs", async () => {
		const cache = await load([
			sg({ name: "closed", account_id: "acct-a", visibility: "private" }),
		]);
		expect(cache.get("closed", "acct-a")?.name).toBe("closed");
		expect(cache.get("closed", "acct-b")).toBeUndefined();
	});

	it("public lookup is account-independent while owned lookup stays scoped", async () => {
		const cache = await load([
			sg({ name: "shared-name", account_id: "acct-a", visibility: "public" }),
		]);
		// Another account's key still reads the public subgraph via public lookup.
		expect(cache.get("shared-name", "acct-b")).toBeUndefined();
		expect(cache.getPublicByName("shared-name")?.account_id).toBe("acct-a");
	});
});
