import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	type IndexCodegenTarget,
	generateIndexSchema,
} from "@secondlayer/subgraphs";
import { z } from "zod";
import { textResponse } from "../lib/format.ts";
import { defineTool } from "../lib/tool.ts";

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
