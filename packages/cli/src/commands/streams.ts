import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createStreamsClient } from "@secondlayer/sdk";
import type {
	StreamsCanonicalBlock,
	StreamsEventType,
	StreamsEventsEnvelope,
	StreamsReorgsListEnvelope,
	StreamsTip,
} from "@secondlayer/sdk";
import type { Command } from "commander";
import { error as logError, note, writeData } from "../lib/output.ts";
import { resolveEnvKey } from "../lib/resolve-auth.ts";

const DEFAULT_BASE_URL = "https://api.secondlayer.tools";

const VALID_TYPES: StreamsEventType[] = [
	"stx_transfer",
	"stx_mint",
	"stx_burn",
	"stx_lock",
	"ft_transfer",
	"ft_mint",
	"ft_burn",
	"nft_transfer",
	"nft_mint",
	"nft_burn",
	"print",
];

function readApiKey(): string {
	const key = resolveEnvKey();
	if (!key) {
		logError(
			"No API key set. Export SL_API_KEY (issue one at https://www.secondlayer.tools/platform/api-keys).",
		);
		process.exit(1);
	}
	return key;
}

function client(): ReturnType<typeof createStreamsClient> {
	return createStreamsClient({
		baseUrl: process.env.SL_API_URL ?? DEFAULT_BASE_URL,
		apiKey: readApiKey(),
	});
}

/** Client for the public bulk dumps. Dumps are unauthenticated, so no API key
 *  is required — only the public dumps base URL. */
function dumpsClient(
	dumpsUrl: string | undefined,
): ReturnType<typeof createStreamsClient> {
	const dumpsBaseUrl = dumpsUrl ?? process.env.SL_STREAMS_DUMPS_URL;
	if (!dumpsBaseUrl) {
		logError(
			"No dumps URL. Pass --dumps-url <url> or set SL_STREAMS_DUMPS_URL (the public bulk bucket base; see GET /public/streams/dumps/manifest).",
		);
		process.exit(1);
	}
	return createStreamsClient({
		baseUrl: process.env.SL_API_URL ?? DEFAULT_BASE_URL,
		apiKey: resolveEnvKey() ?? "",
		dumpsBaseUrl,
	});
}

function parseTypes(
	value?: string,
	flag = "--types",
): StreamsEventType[] | undefined {
	if (!value) return undefined;
	const parts = value.split(",").map((s) => s.trim());
	for (const p of parts) {
		if (!VALID_TYPES.includes(p as StreamsEventType)) {
			throw new Error(
				`invalid ${flag} value "${p}"; expected one of: ${VALID_TYPES.join(", ")}`,
			);
		}
	}
	return parts as StreamsEventType[];
}

/** Parse a single-or-comma-list filter into a string (one) or string[] (many). */
function parseList(value?: string): string | string[] | undefined {
	if (value === undefined) return undefined;
	const parts = value
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
	if (parts.length === 0) return undefined;
	return parts.length === 1 ? parts[0] : parts;
}

function parseLimit(value?: string): number | undefined {
	if (value === undefined) return undefined;
	const n = Number.parseInt(value, 10);
	if (!Number.isFinite(n) || n < 1 || n > 1000) {
		throw new Error("--limit must be an integer between 1 and 1000");
	}
	return n;
}

function parseHeight(
	value: string | undefined,
	name: string,
): number | undefined {
	if (value === undefined) return undefined;
	const n = Number.parseInt(value, 10);
	if (!Number.isFinite(n) || n < 0) {
		throw new Error(`${name} must be a non-negative integer`);
	}
	return n;
}

export function registerStreamsCommand(program: Command): void {
	const streams = program
		.command("streams")
		.description("Read raw chain events from Streams (requires SL_API_KEY)");

	streams
		.command("tip")
		.description("Print current canonical tip")
		.option("--json", "Output as JSON (streams always emits JSON)")
		.action(async () => {
			try {
				const tip: StreamsTip = await client().tip();
				writeData(JSON.stringify(tip, null, 2));
			} catch (err) {
				logError(err instanceof Error ? err.message : String(err));
				process.exit(1);
			}
		});

	const events = streams
		.command("events")
		.description("List events (cursor-paginated; one page per call)")
		.option(
			"--types <types>",
			`comma-separated event types (${VALID_TYPES.join(", ")})`,
		)
		.option("--not-types <types>", "comma-separated event types to exclude")
		.option("--contract-id <ids>", "comma-separated contract identifier(s)")
		.option("--sender <addrs>", "comma-separated sender principal(s)")
		.option("--recipient <addrs>", "comma-separated recipient principal(s)")
		.option("--cursor <cursor>", "start cursor (block_height:event_index)")
		.option("--from-block <n>", "filter to blocks >= n")
		.option("--to-block <n>", "filter to blocks <= n")
		.option("--limit <n>", "page size (1-1000, default 100)", "100")
		.option("--json", "Output as JSON (streams always emits JSON)")
		.addHelpText(
			"after",
			`
Examples:
  $ sl streams events --types stx_transfer,print --limit 50
  $ sl streams events --not-types print --contract-id SP00....token,SP01....token
  $ sl streams events --sender SP1...,SP2... --from-block 150000 --to-block 160000
  $ sl streams events --cursor 150000:3`,
		)
		.action(
			async (options: {
				types?: string;
				notTypes?: string;
				contractId?: string;
				sender?: string;
				recipient?: string;
				cursor?: string;
				fromBlock?: string;
				toBlock?: string;
				limit?: string;
			}) => {
				try {
					const envelope: StreamsEventsEnvelope = await client().events.list({
						types: parseTypes(options.types),
						notTypes: parseTypes(options.notTypes, "--not-types"),
						contractId: parseList(options.contractId),
						sender: parseList(options.sender),
						recipient: parseList(options.recipient),
						cursor: options.cursor,
						fromHeight: parseHeight(options.fromBlock, "--from-block"),
						toHeight: parseHeight(options.toBlock, "--to-block"),
						limit: parseLimit(options.limit),
					});
					writeData(JSON.stringify(envelope, null, 2));
				} catch (err) {
					logError(err instanceof Error ? err.message : String(err));
					process.exit(1);
				}
			},
		);

	events
		.command("by-tx <txId>")
		.description("List all events emitted by a single transaction")
		.option("--json", "Output as JSON (streams always emits JSON)")
		.action(async (txId: string) => {
			try {
				const envelope = await client().events.byTxId(txId);
				writeData(JSON.stringify(envelope, null, 2));
			} catch (err) {
				logError(err instanceof Error ? err.message : String(err));
				process.exit(1);
			}
		});

	streams
		.command("consume")
		.description(
			"Long-running pull from a cursor; emits one event per line (jsonl) until SIGINT or --max-pages",
		)
		.option(
			"--types <types>",
			`comma-separated event types (${VALID_TYPES.join(", ")})`,
		)
		.option("--not-types <types>", "comma-separated event types to exclude")
		.option("--contract-id <ids>", "comma-separated contract identifier(s)")
		.option("--sender <addrs>", "comma-separated sender principal(s)")
		.option("--recipient <addrs>", "comma-separated recipient principal(s)")
		.option("--cursor <cursor>", "start cursor (block_height:event_index)")
		.option("--batch-size <n>", "events per batch (1-1000, default 100)", "100")
		.option("--max-pages <n>", "stop after N pages (default: run until SIGINT)")
		.addHelpText(
			"after",
			`
Examples:
  $ sl streams consume --types print --cursor 150000:0
  $ sl streams consume --not-types print --sender SP1...,SP2... --batch-size 500 --max-pages 10`,
		)
		.action(
			async (options: {
				types?: string;
				notTypes?: string;
				contractId?: string;
				sender?: string;
				recipient?: string;
				cursor?: string;
				batchSize?: string;
				maxPages?: string;
			}) => {
				try {
					const batchSize = parseLimit(options.batchSize) ?? 100;
					const maxPages = options.maxPages
						? Number.parseInt(options.maxPages, 10)
						: undefined;
					note(
						"# streaming events to stdout (jsonl); next_cursor printed to stderr",
					);
					await client().events.consume({
						fromCursor: options.cursor,
						types: parseTypes(options.types),
						notTypes: parseTypes(options.notTypes, "--not-types"),
						contractId: parseList(options.contractId),
						sender: parseList(options.sender),
						recipient: parseList(options.recipient),
						batchSize,
						mode: "tail",
						maxPages,
						onBatch: (events, envelope) => {
							for (const e of events) {
								process.stdout.write(`${JSON.stringify(e)}\n`);
							}
							if (envelope.next_cursor) {
								process.stderr.write(`# next_cursor=${envelope.next_cursor}\n`);
							}
							return envelope.next_cursor;
						},
					});
				} catch (err) {
					logError(err instanceof Error ? err.message : String(err));
					process.exit(1);
				}
			},
		);

	streams
		.command("reorgs")
		.description("List recent reorgs (cursor-paginated)")
		.requiredOption(
			"--since <cursor>",
			"start cursor (block_height:event_index)",
		)
		.option("--limit <n>", "page size (default 100)", "100")
		.option("--json", "Output as JSON (streams always emits JSON)")
		.action(async (options: { since: string; limit?: string }) => {
			try {
				const envelope: StreamsReorgsListEnvelope = await client().reorgs.list({
					since: options.since,
					limit: parseLimit(options.limit),
				});
				writeData(JSON.stringify(envelope, null, 2));
			} catch (err) {
				logError(err instanceof Error ? err.message : String(err));
				process.exit(1);
			}
		});

	streams
		.command("pull")
		.description(
			"Download finalized bulk parquet dumps to a local dir (verifies sha256)",
		)
		.requiredOption("--to <dir>", "output directory")
		.option(
			"--dumps-url <url>",
			"public dumps base URL (or SL_STREAMS_DUMPS_URL)",
		)
		.option("--from-block <n>", "only files covering blocks >= n")
		.option("--to-block <n>", "only files covering blocks <= n")
		.addHelpText(
			"after",
			`
Examples:
  $ sl streams pull --to ./dump
  $ sl streams pull --to ./dump --from-block 150000 --to-block 200000`,
		)
		.action(
			async (options: {
				to: string;
				dumpsUrl?: string;
				fromBlock?: string;
				toBlock?: string;
			}) => {
				try {
					const fromBlock = parseHeight(options.fromBlock, "--from-block");
					const toBlock = parseHeight(options.toBlock, "--to-block");
					const dumps = dumpsClient(options.dumpsUrl).dumps;
					const manifest = await dumps.list();
					const files = manifest.files.filter(
						(f) =>
							(fromBlock === undefined || f.to_block >= fromBlock) &&
							(toBlock === undefined || f.from_block <= toBlock),
					);
					if (files.length === 0) {
						note("# no dump files match the requested range");
						return;
					}
					note(`# downloading ${files.length} file(s) to ${options.to}`);
					for (const file of files) {
						const bytes = await dumps.download(file);
						const dest = join(options.to, file.path);
						await mkdir(dirname(dest), { recursive: true });
						await writeFile(dest, bytes);
						process.stderr.write(
							`# ${file.path} (${file.row_count} rows, ${bytes.byteLength} bytes)\n`,
						);
					}
					writeData(
						JSON.stringify(
							{
								files: files.length,
								to: options.to,
								latest_finalized_cursor: manifest.latest_finalized_cursor,
							},
							null,
							2,
						),
					);
				} catch (err) {
					logError(err instanceof Error ? err.message : String(err));
					process.exit(1);
				}
			},
		);

	streams
		.command("canonical <height>")
		.description("Canonical block metadata at a given height")
		.option("--json", "Output as JSON (streams always emits JSON)")
		.action(async (heightArg: string) => {
			try {
				const height = parseHeight(heightArg, "<height>");
				if (height === undefined) throw new Error("<height> is required");
				const block: StreamsCanonicalBlock = await client().canonical(height);
				writeData(JSON.stringify(block, null, 2));
			} catch (err) {
				logError(err instanceof Error ? err.message : String(err));
				process.exit(1);
			}
		});

	streams
		.command("block-events <heightOrHash>")
		.description("List all events in a single block (by height or block hash)")
		.option("--json", "Output as JSON (streams always emits JSON)")
		.action(async (heightOrHash: string) => {
			try {
				const ref = /^\d+$/.test(heightOrHash)
					? Number.parseInt(heightOrHash, 10)
					: heightOrHash;
				const envelope = await client().blocks.events(ref);
				writeData(JSON.stringify(envelope, null, 2));
			} catch (err) {
				logError(err instanceof Error ? err.message : String(err));
				process.exit(1);
			}
		});
}
