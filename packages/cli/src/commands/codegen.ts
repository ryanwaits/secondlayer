import type { Command } from "commander";

/**
 * `secondlayer codegen …` — the one place code is generated.
 *
 * Code generation used to be spread across six per-product entry points under
 * three verbs, with the SAME flag carrying opposite ORM defaults depending on
 * which one you reached for. There was no mental model for "generate
 * something". Every subcommand here takes `-o/--output` and, where an ORM
 * applies, the same `--target` with the same default (`kysely`).
 */
export function registerCodegenCommand(program: Command): void {
	const codegen = program
		.command("codegen")
		.description("Generate typed code: contracts, subgraphs, Index, clients");

	// --- contracts ---
	codegen
		.command("contracts [files...]")
		.description("Generate TypeScript interfaces from Clarity contracts")
		.option("-c, --config <path>", "Path to config file")
		.option("-o, --output <path>", "Output file path")
		.option("-k, --api-key <key>", "Stacks node API key for direct RPC URLs")
		.option("-w, --watch", "Watch for changes")
		.action(async (files: string[], options: { output?: string }) => {
			const { generate } = await import("./generate.ts");
			await generate(files, { ...options, out: options.output });
		});

	// --- subgraph ORM schema / print payloads ---
	codegen
		.command("subgraph <file>")
		.description(
			"Generate an ORM schema (Kysely, Prisma, or Drizzle) for a subgraph's tables",
		)
		.option("--target <orm>", "ORM target: kysely | prisma | drizzle", "kysely")
		.option(
			"--schema <name>",
			"Postgres schema name (defaults to subgraph_<name>)",
		)
		.option("--env <var>", "datasource url env var", "DATABASE_URL")
		.option(
			"--models-only",
			"Emit only Prisma models (compose via prismaSchemaFolder)",
		)
		.option("-o, --output <path>", "Write to a file (defaults to stdout)")
		.action(async (file: string, options, command: Command) => {
			const { runSubgraphSchemaCodegen } = await import("./subgraphs.ts");
			await runSubgraphSchemaCodegen(
				file,
				options,
				(key) => command.getOptionValueSource(key),
				"kysely",
			);
		});

	// --- Index domain tables ---
	codegen
		.command("index")
		.description(
			"Generate a typed schema (Kysely, Prisma, Drizzle, or JSON-Schema) for the Index domain tables",
		)
		.option(
			"--target <orm>",
			"kysely | prisma | drizzle | json-schema",
			"kysely",
		)
		.option("--schema <name>", "Postgres schema to qualify table names with")
		.option(
			"--tables <list>",
			"Comma-separated subset of Index tables (default: all)",
		)
		.option("--env <var>", "Prisma datasource url env var", "DATABASE_URL")
		.option("-o, --output <path>", "Write to a file (defaults to stdout)")
		.action(async (options) => {
			const { runIndexCodegen } = await import("./index-api.ts");
			await runIndexCodegen(options);
		});

	// --- typed query client for a deployed subgraph ---
	codegen
		.command("client <subgraphName>")
		.description("Generate a typed query client for a deployed subgraph")
		.option("-o, --output <path>", "Output file path (required)")
		.action(async (subgraphName: string, options: { output?: string }) => {
			const { runSubgraphClientCodegen } = await import("./subgraphs.ts");
			await runSubgraphClientCodegen(subgraphName, options);
		});

	// --- print payload types for a subgraph's pinned print sources ---
	codegen
		.command("prints <file>")
		.description(
			"Emit a .d.ts of print payload types for a subgraph's pinned print_event sources (inferred from observed on-chain events; requires network)",
		)
		.option("-o, --output <path>", "Write to a file (defaults to stdout)")
		.action(async (file: string, options: { output?: string }) => {
			const { runPayloadsCodegen } = await import("./subgraphs.ts");
			await runPayloadsCodegen(file, options.output);
		});
}
