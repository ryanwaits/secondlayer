import { describe, expect, test } from "bun:test";
import type { SubgraphDetail } from "../schemas/subgraphs.ts";
import {
	generateSubgraphAgentSchema,
	generateSubgraphMarkdown,
	generateSubgraphOpenApi,
} from "./spec.ts";

const detail: SubgraphDetail = {
	name: "test-subgraph",
	version: "1.2.3",
	schemaHash: "hash-123",
	status: "active",
	lastProcessedBlock: 123,
	description: "Indexes test listings.",
	sources: { listings: { type: "print_event" } },
	health: {
		totalProcessed: 1,
		totalErrors: 0,
		errorRate: 0,
		lastError: null,
		lastErrorAt: null,
	},
	sync: {
		status: "synced",
		startBlock: 1,
		lastProcessedBlock: 123,
		chainTip: 123,
		blocksRemaining: 0,
		progress: 1,
		gaps: { count: 0, totalMissingBlocks: 0, ranges: [] },
		integrity: "complete",
	},
	tables: {
		listings: {
			endpoint: "/subgraphs/test-subgraph/listings",
			rowCount: 4,
			columns: {
				nft_id: { type: "text", indexed: true },
				price: { type: "uint" },
				metadata: { type: "jsonb", nullable: true },
				_id: { type: "serial" },
				_block_height: { type: "bigint" },
				_tx_id: { type: "text" },
				_created_at: { type: "timestamp" },
			},
			indexes: [["nft_id"]],
			uniqueKeys: [["nft_id"]],
			example: "/subgraphs/test-subgraph/listings?_limit=10",
		},
	},
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("subgraph spec generation", () => {
	test("generates agent schema with endpoints, filters, and static examples", () => {
		const schema = generateSubgraphAgentSchema(detail, {
			serverUrl: "https://tenant.example.test/",
			generatedAt: "2026-01-01T00:00:00.000Z",
		});

		expect(schema.schemaHash).toBe("hash-123");
		expect(schema.tables.listings.endpoint).toBe(
			"https://tenant.example.test/api/subgraphs/test-subgraph/listings",
		);
		expect(schema.tables.listings.query.filters).toContain("price.gte");
		expect(schema.tables.listings.query.filters).toContain("nft_id.like");
		expect(schema.tables.listings.examples.list.price).toBe("1000");
	});

	test("generates OpenAPI paths for table and count endpoints", () => {
		const spec = generateSubgraphOpenApi(detail, {
			serverUrl: "https://tenant.example.test",
			generatedAt: "2026-01-01T00:00:00.000Z",
		}) as {
			paths: Record<string, unknown>;
			[key: string]: unknown;
		};

		expect(spec.paths["/api/subgraphs/test-subgraph/listings"]).toBeDefined();
		expect(
			spec.paths["/api/subgraphs/test-subgraph/listings/count"],
		).toBeDefined();
		expect(spec["x-secondlayer-schema-hash"]).toBe("hash-123");
	});

	test("generates Markdown reference", () => {
		const markdown = generateSubgraphMarkdown(detail, {
			serverUrl: "https://tenant.example.test",
			generatedAt: "2026-01-01T00:00:00.000Z",
		});

		expect(markdown).toContain("# test-subgraph Subgraph API");
		expect(markdown).toContain("`price.gte`");
		expect(markdown).toContain(
			"curl 'https://tenant.example.test/api/subgraphs/test-subgraph/listings",
		);
	});
});
