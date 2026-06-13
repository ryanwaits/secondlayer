import { resolve } from "node:path";
import { Index } from "@secondlayer/sdk";
import type { Command } from "commander";
import { writeTextFile } from "../lib/fs.ts";
import {
	error as logError,
	note,
	output,
	success,
	writeData,
} from "../lib/output.ts";
import { resolveEnvKey } from "../lib/resolve-auth.ts";

const DEFAULT_BASE_URL = "https://api.secondlayer.tools";

/**
 * Index reads allow anonymous access, but free-tier API keys are rejected
 * (Build+ required). So the key is optional: pass it through when present,
 * and translate the 403 into an actionable hint.
 */
function client(): Index {
	return new Index({
		baseUrl: process.env.SL_API_URL ?? DEFAULT_BASE_URL,
		apiKey: resolveEnvKey(),
	});
}

function fail(action: string, err: unknown): never {
	const message = err instanceof Error ? err.message : String(err);
	logError(`Failed to ${action}: ${message}`);
	if (/\b403\b/.test(message) || /forbidden/i.test(message)) {
		note(
			"The Index API requires a Build+ tier key (free-tier keys are rejected).",
		);
	}
	process.exit(1);
}

type ListOptions = {
	contractId?: string;
	sender?: string;
	recipient?: string;
	assetIdentifier?: string;
	functionName?: string;
	eventType?: string;
	type?: string;
	stacker?: string;
	caller?: string;
	fromHeight?: string;
	toHeight?: string;
	cursor?: string;
	limit?: string;
	json?: boolean;
};

/** Coerce the height/cursor/limit params shared by the paginated endpoints. */
function heightParams(o: ListOptions) {
	return {
		fromHeight: o.fromHeight ? Number.parseInt(o.fromHeight, 10) : undefined,
		toHeight: o.toHeight ? Number.parseInt(o.toHeight, 10) : undefined,
		cursor: o.cursor,
		limit: o.limit ? Number.parseInt(o.limit, 10) : undefined,
	};
}

/** As {@link heightParams} plus the shared `--contract-id` filter. */
function rangeParams(o: ListOptions) {
	return { contractId: o.contractId, ...heightParams(o) };
}

function emit(env: { next_cursor: string | null }, json?: boolean): void {
	output({
		json,
		data: env,
		human: () => {
			writeData(JSON.stringify(env, null, 2));
			if (env.next_cursor) note(`next_cursor: ${env.next_cursor}`);
		},
	});
}

/** Print a single fetched document; SDK get(...) resolves null on 404. */
function emitOne(doc: unknown, label: string, json?: boolean): void {
	if (doc == null) {
		logError(`Not found: ${label}`);
		process.exit(1);
	}
	output({
		json,
		data: doc,
		human: () => writeData(JSON.stringify(doc, null, 2)),
	});
}

export function registerIndexCommand(program: Command): void {
	const index = program
		.command("index")
		.description("Query the decoded Index layer (events + contract calls)");

	// Codegen needs no API call — it emits from the static read-column registry.
	index
		.command("codegen")
		.description(
			"Generate a typed schema (Prisma, Kysely, Drizzle, or JSON-Schema) for the Index domain tables — point it at your BYO database mirror",
		)
		.option(
			"--target <orm>",
			"prisma | kysely | drizzle | json-schema",
			"kysely",
		)
		.option("--schema <name>", "Postgres schema to qualify table names with")
		.option(
			"--tables <list>",
			"Comma-separated subset of Index tables (default: all)",
		)
		.option("--env <var>", "Prisma datasource url env var", "DATABASE_URL")
		.option("-o, --output <path>", "Write to a file (defaults to stdout)")
		.action(
			async (o: {
				target?: string;
				schema?: string;
				tables?: string;
				env?: string;
				output?: string;
			}) => {
				try {
					const target = o.target ?? "kysely";
					if (
						target !== "prisma" &&
						target !== "kysely" &&
						target !== "drizzle" &&
						target !== "json-schema"
					) {
						logError(
							`Unsupported --target "${target}" (supported: prisma, kysely, drizzle, json-schema).`,
						);
						process.exit(1);
					}
					const { generateIndexSchema } = await import(
						"@secondlayer/subgraphs"
					);
					const tables = o.tables
						? o.tables
								.split(",")
								.map((t) => t.trim())
								.filter(Boolean)
						: undefined;
					const out = generateIndexSchema(target, {
						schemaName: o.schema,
						tables,
						datasourceEnv: o.env,
					});
					if (o.output) {
						await writeTextFile(resolve(o.output), out);
						success(`Wrote ${target} Index schema to ${o.output}`);
					} else {
						process.stdout.write(out);
					}
				} catch (err) {
					logError(`Failed to generate Index schema: ${err}`);
					process.exit(1);
				}
			},
		);

	const rangeFlags = (cmd: Command): Command =>
		cmd
			.option("--contract-id <id>", "Filter by contract id")
			.option("--from-height <n>", "Start block height (inclusive)")
			.option("--to-height <n>", "End block height (inclusive)")
			.option("--cursor <cursor>", "Resume token from a previous next_cursor")
			.option("--limit <n>", "Rows per page")
			.option("--json", "Print the full envelope as JSON");

	// Height-paginated endpoints that don't filter by contract.
	const heightFlags = (cmd: Command): Command =>
		cmd
			.option("--from-height <n>", "Start block height (inclusive)")
			.option("--to-height <n>", "End block height (inclusive)")
			.option("--cursor <cursor>", "Resume token from a previous next_cursor")
			.option("--limit <n>", "Rows per page")
			.option("--json", "Print the full envelope as JSON");

	rangeFlags(index.command("ft-transfers"))
		.description("List decoded SIP-010 fungible-token transfers")
		.option("--sender <principal>", "Filter by sender")
		.option("--recipient <principal>", "Filter by recipient")
		.action(async (o: ListOptions) => {
			try {
				emit(
					await client().ftTransfers.list({
						...rangeParams(o),
						sender: o.sender,
						recipient: o.recipient,
					}),
					o.json,
				);
			} catch (err) {
				fail("list ft transfers", err);
			}
		});

	rangeFlags(index.command("nft-transfers"))
		.description("List decoded SIP-009 non-fungible-token transfers")
		.option("--sender <principal>", "Filter by sender")
		.option("--recipient <principal>", "Filter by recipient")
		.option("--asset-identifier <id>", "Filter by asset identifier")
		.action(async (o: ListOptions) => {
			try {
				emit(
					await client().nftTransfers.list({
						...rangeParams(o),
						sender: o.sender,
						recipient: o.recipient,
						assetIdentifier: o.assetIdentifier,
					}),
					o.json,
				);
			} catch (err) {
				fail("list nft transfers", err);
			}
		});

	rangeFlags(index.command("events"))
		.description(
			"List decoded events by type (stx_*, ft/nft mint/burn, print, …)",
		)
		.requiredOption("--event-type <type>", "Decoded event type (required)")
		.option("--sender <principal>", "Filter by sender")
		.option("--recipient <principal>", "Filter by recipient")
		.option("--asset-identifier <id>", "Filter by asset identifier")
		.action(async (o: ListOptions) => {
			try {
				emit(
					await client().events.list({
						// biome-ignore lint/suspicious/noExplicitAny: event_type is validated server-side
						eventType: o.eventType as any,
						...rangeParams(o),
						sender: o.sender,
						recipient: o.recipient,
						assetIdentifier: o.assetIdentifier,
					}),
					o.json,
				);
			} catch (err) {
				fail("list events", err);
			}
		});

	rangeFlags(index.command("contract-calls"))
		.description("List decoded contract calls (function, args, result)")
		.option("--function-name <name>", "Filter by called function")
		.option("--sender <principal>", "Filter by caller")
		.action(async (o: ListOptions) => {
			try {
				emit(
					await client().contractCalls.list({
						...rangeParams(o),
						functionName: o.functionName,
						sender: o.sender,
					}),
					o.json,
				);
			} catch (err) {
				fail("list contract calls", err);
			}
		});

	heightFlags(index.command("canonical"))
		.description("List the canonical Stacks block sequence (height + hash)")
		.action(async (o: ListOptions) => {
			try {
				emit(await client().canonical.list(heightParams(o)), o.json);
			} catch (err) {
				fail("list canonical blocks", err);
			}
		});

	const blocks = heightFlags(index.command("blocks"))
		.description("List decoded blocks (run `blocks get <ref>` for one block)")
		.action(async (o: ListOptions) => {
			try {
				emit(await client().blocks.list(heightParams(o)), o.json);
			} catch (err) {
				fail("list blocks", err);
			}
		});

	blocks
		.command("get <ref>")
		.description("Get a single block by height or block hash")
		.option("--json", "Print as JSON")
		.action(async (ref: string, o: ListOptions) => {
			try {
				const block = await client().blocks.get(
					/^\d+$/.test(ref) ? Number.parseInt(ref, 10) : ref,
				);
				emitOne(block, `block ${ref}`, o.json);
			} catch (err) {
				fail("get block", err);
			}
		});

	const transactions = rangeFlags(index.command("transactions"))
		.description(
			"List decoded transactions (run `transactions get <txId>` for one)",
		)
		.option("--type <type>", "Filter by transaction type")
		.option("--sender <principal>", "Filter by sender")
		.action(async (o: ListOptions) => {
			try {
				emit(
					await client().transactions.list({
						...rangeParams(o),
						type: o.type,
						sender: o.sender,
					}),
					o.json,
				);
			} catch (err) {
				fail("list transactions", err);
			}
		});

	transactions
		.command("get <txId>")
		.description("Get a single transaction by tx_id")
		.option("--json", "Print as JSON")
		.action(async (txId: string, o: ListOptions) => {
			try {
				emitOne(await client().transactions.get(txId), `tx ${txId}`, o.json);
			} catch (err) {
				fail("get transaction", err);
			}
		});

	heightFlags(index.command("stacking"))
		.description("List decoded PoX-4 stacking actions")
		.option("--function-name <name>", "Filter by PoX function name")
		.option("--stacker <principal>", "Filter by stacker")
		.option("--caller <principal>", "Filter by caller")
		.action(async (o: ListOptions) => {
			try {
				emit(
					await client().stacking.list({
						...heightParams(o),
						functionName: o.functionName,
						stacker: o.stacker,
						caller: o.caller,
					}),
					o.json,
				);
			} catch (err) {
				fail("list stacking actions", err);
			}
		});

	const mempool = index
		.command("mempool")
		.description(
			"List pending mempool transactions (run `mempool get <txId>` for one)",
		)
		.option("--contract-id <id>", "Filter to pending calls to a contract")
		.option("--sender <principal>", "Filter by sender")
		.option("--type <type>", "Filter by transaction type")
		.option("--cursor <cursor>", "Resume token from a previous next_cursor")
		.option("--limit <n>", "Rows per page")
		.option("--json", "Print the full envelope as JSON")
		.action(async (o: ListOptions) => {
			try {
				emit(
					await client().mempool.list({
						contractId: o.contractId,
						sender: o.sender,
						type: o.type,
						cursor: o.cursor,
						limit: o.limit ? Number.parseInt(o.limit, 10) : undefined,
					}),
					o.json,
				);
			} catch (err) {
				fail("list mempool", err);
			}
		});

	mempool
		.command("get <txId>")
		.description("Get a single pending transaction by tx_id (404 once mined)")
		.option("--json", "Print as JSON")
		.action(async (txId: string, o: ListOptions) => {
			try {
				emitOne(await client().mempool.get(txId), `pending tx ${txId}`, o.json);
			} catch (err) {
				fail("get mempool tx", err);
			}
		});
}
