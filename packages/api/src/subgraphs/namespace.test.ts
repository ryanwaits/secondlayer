import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Subgraph } from "@secondlayer/shared/db";
import { pgSchemaName } from "@secondlayer/shared/db/queries/subgraphs";
import { SubgraphRegistryCache } from "./cache.ts";
import {
	deployAccountId,
	deploySchemaName,
	resolveReadableSubgraph,
} from "./namespace.ts";

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
		created_at: new Date(),
		updated_at: new Date(),
		...overrides,
	} as Subgraph;
}

describe("local namespace", () => {
	let prevMode: string | undefined;

	beforeEach(() => {
		prevMode = process.env.INSTANCE_MODE;
	});

	afterEach(() => {
		if (prevMode === undefined) delete process.env.INSTANCE_MODE;
		else process.env.INSTANCE_MODE = prevMode;
	});

	async function load(subgraphs: Subgraph[]): Promise<SubgraphRegistryCache> {
		const cache = new SubgraphRegistryCache(async () => subgraphs);
		await cache.refresh();
		return cache;
	}

	it("OSS resolves a private subgraph by name with no account", async () => {
		process.env.INSTANCE_MODE = "oss";
		const cache = await load([
			sg({ name: "local", visibility: "private", account_id: "" }),
		]);
		expect(resolveReadableSubgraph(cache, "local")?.name).toBe("local");
		expect(resolveReadableSubgraph(cache, "missing")).toBeUndefined();
	});

	it("OSS deploy drops the request account", () => {
		process.env.INSTANCE_MODE = "oss";
		expect(deployAccountId("acct-a")).toBeUndefined();
		expect(deploySchemaName("demo", "acct-a")).toBe(pgSchemaName("demo"));
	});

	it("platform deploy keeps the request account and prefers a stored schema", () => {
		process.env.INSTANCE_MODE = "platform";
		expect(deployAccountId("acct-a")).toBe("acct-a");
		expect(deploySchemaName("demo", "acct-a", "subgraph_kept")).toBe(
			"subgraph_kept",
		);
	});
});
