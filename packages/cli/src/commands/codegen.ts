import type { Command } from "commander";
import { warn } from "../lib/output.ts";

/**
 * `secondlayer codegen …` — the one place code is generated.
 *
 * There used to be six entry points under three verbs (`secondlayer contracts
 * generate`, `secondlayer subgraphs codegen`, `secondlayer index codegen`, `secondlayer subgraphs
 * scaffold`, `secondlayer subgraphs create --from-contract`, `secondlayer subgraphs client`),
 * with the SAME flag carrying opposite defaults: `secondlayer subgraphs codegen -o
 * db.ts` wrote Prisma while the muscle-memory-identical `secondlayer index codegen -o
 * db.ts` wrote Kysely. There was no mental model for "generate something".
 *
 * Every subcommand here takes `-o/--output` and, where an ORM applies, the
 * same `--target` with the same default (`kysely`). The old paths keep
 * working as hidden aliases (with their original defaults, so existing
 * scripts don't silently change output) until the next major.
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

/** One-line notice printed by a deprecated codegen path. */
export function deprecatedCodegenNotice(
	oldPath: string,
	newPath: string,
): void {
	warn(
		`\`${oldPath}\` is deprecated — use \`${newPath}\`. (The new verb defaults --target to kysely everywhere; this alias keeps its original default so your output does not change.)`,
	);
}
