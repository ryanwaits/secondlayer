import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	type IndexCodegenTarget,
	generateIndexSchema,
} from "@secondlayer/subgraphs";
import { z } from "zod";
import { textResponse } from "../lib/format.ts";
import { defineTool } from "../lib/tool.ts";

/**
 * Codegen over MCP.
 *
 * An agent that has just read rows off `/v1/index` usually wants the ORM types
 * for them next, and the CLI path (`sl codegen index`) means shelling out of
 * the conversation. These are thin wrappers over the same generators the CLI
 * calls, so the emitted schema is identical either way — no second
 * implementation to drift.
 */
const TARGETS = ["prisma", "kysely", "drizzle", "json-schema"] as const;

export function registerCodegenTools(server: McpServer) {
	defineTool<{
		target?: IndexCodegenTarget;
		tables?: string[];
		schemaName?: string;
		datasourceEnv?: string;
	}>(
		server,
		"codegen_index_schema",
		"Generate an ORM schema for the Index tables (blocks, transactions, decoded_events, …) — the same output as `sl codegen index`. Returns the file contents as text; write it wherever your project keeps its schema. Use `tables` to emit only what you read.",
		{
			target: z
				.enum(TARGETS)
				.optional()
				.describe("Output flavor (default kysely)"),
			tables: z
				.array(z.string())
				.optional()
				.describe("Restrict to these Index tables (default: all)"),
			schemaName: z
				.string()
				.optional()
				.describe("Postgres schema to qualify table names with"),
			datasourceEnv: z
				.string()
				.optional()
				.describe("Prisma only: datasource url env var (default DATABASE_URL)"),
		},
		({ target, tables, schemaName, datasourceEnv }) =>
			textResponse(
				generateIndexSchema(target ?? "kysely", {
					tables,
					schemaName,
					datasourceEnv,
				}),
			),
	);
}
