import { describe, expect, it } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerSubgraphTools } from "../tools/subgraphs.ts";
import { registerWebhookTools } from "../tools/webhooks.ts";
import { subgraphNameSchema, tableNameSchema, webhookIdSchema } from "./ids.ts";

const UUID = "3f8c1a2e-0000-4000-8000-00000000ab01";
const HOSTILE = [".", "..", "", "a/b", "a?x", "a#y", "%2e%2e", "a b"];

describe("tool identifier schemas", () => {
	it("webhook ids are UUIDs", () => {
		expect(webhookIdSchema.safeParse(UUID).success).toBe(true);
		for (const bad of HOSTILE) {
			expect(webhookIdSchema.safeParse(bad).success, bad).toBe(false);
		}
	});

	it("subgraph names are lowercase alphanumerics and hyphens", () => {
		expect(subgraphNameSchema.safeParse("my-subgraph-2").success).toBe(true);
		for (const bad of [...HOSTILE, "Upper", "under_score", "a".repeat(64)]) {
			expect(subgraphNameSchema.safeParse(bad).success, bad).toBe(false);
		}
	});

	it("table names are SQL identifiers", () => {
		expect(tableNameSchema.safeParse("transfers_v2").success).toBe(true);
		for (const bad of [...HOSTILE, "1abc", "a-b"]) {
			expect(tableNameSchema.safeParse(bad).success, bad).toBe(false);
		}
	});
});

describe("registered tools take only safe path identifiers", () => {
	const schemas = new Map<string, z.ZodObject<z.ZodRawShape>>();
	const server = {
		tool: (name: string, _d: string, shape: z.ZodRawShape) => {
			schemas.set(name, z.object(shape));
		},
	} as unknown as McpServer;
	registerWebhookTools(server);
	registerSubgraphTools(server);

	it("every webhook tool with an id refuses '.' and '..'", () => {
		let checked = 0;
		for (const [name, schema] of schemas) {
			if (!name.startsWith("webhooks_") || !("id" in schema.shape)) continue;
			checked++;
			for (const bad of [".", ".."]) {
				const input = {
					id: bad,
					outboxId: UUID,
					fromBlock: 1,
					toBlock: 2,
					triggers: [],
				};
				expect(schema.safeParse(input).success, `${name} ${bad}`).toBe(false);
			}
		}
		expect(checked).toBeGreaterThan(8);
	});

	it("requeue refuses a dot outbox id", () => {
		const schema = schemas.get("webhooks_requeue");
		expect(schema?.safeParse({ id: UUID, outboxId: "." }).success).toBe(false);
		expect(schema?.safeParse({ id: UUID, outboxId: UUID }).success).toBe(true);
	});

	it("every subgraph tool with a name refuses '..'", () => {
		let checked = 0;
		for (const [name, schema] of schemas) {
			if (!name.startsWith("subgraphs_") || !("name" in schema.shape)) continue;
			checked++;
			const input = {
				name: "..",
				table: "t",
				fromBlock: 1,
				toBlock: 2,
				handlerCode: "x",
			};
			expect(schema.safeParse(input).success, name).toBe(false);
		}
		expect(checked).toBeGreaterThan(5);
	});
});
