import { createHash } from "node:crypto";
import { mkdir, open, rename } from "node:fs/promises";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { createStreamsClient } from "@secondlayer/sdk";
import type {
	StreamsBatchContext,
	StreamsCanonicalBlock,
	StreamsDumpFile,
	StreamsEvent,
	StreamsEventType,
	StreamsEventsEnvelope,
	StreamsReorg,
	StreamsReorgContext,
	StreamsReorgsListEnvelope,
	StreamsTip,
} from "@secondlayer/sdk";
import { STREAMS_EVENT_TYPES } from "@secondlayer/shared";
import type { Command } from "commander";
import { error as logError, note, writeData } from "../lib/output.ts";
import { resolveApiUrl, resolveEnvKey } from "../lib/resolve-auth.ts";

// Single-sourced from @secondlayer/shared so the CLI can't advertise a stale
// subset of the Streams event vocab (drift test in streams.test.ts).
export const VALID_TYPES: readonly StreamsEventType[] = STREAMS_EVENT_TYPES;

function client(): ReturnType<typeof createStreamsClient> {
	return createStreamsClient({
		baseUrl: resolveApiUrl(),
		apiKey: resolveEnvKey() ?? "",
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
		baseUrl: resolveApiUrl(),
		apiKey: resolveEnvKey() ?? "",
		dumpsBaseUrl,
	});
}

/**
 * Where a manifest entry lands on disk. The manifest is signed, but the key
 * that signs it comes from whatever `SL_API_URL` names, so a path in it is
 * still input: absolute paths, `..` segments, and anything that resolves
 * outside `to` are refused before a byte is written.
 */
export function resolveDumpDest(to: string, filePath: string): string {
	const root = resolve(to);
	const segments = filePath.split(/[\\/]/);
	if (
		filePath.length === 0 ||
		isAbsolute(filePath) ||
		filePath.includes("\\") ||
		segments.some((s) => s === "..")
	) {
		throw new Error(
			`refusing dump path "${filePath}": paths must be relative and stay under ${root}`,
		);
	}
	const dest = resolve(root, filePath);
	if (!dest.startsWith(root + sep)) {
		throw new Error(
			`refusing dump path "${filePath}": resolves outside ${root}`,
		);
	}
	return dest;
}

/**
 * Stream one dump file into `<dest>.part`, hashing as it lands, and rename
 * into place only once the digest matches the manifest. A crash or a bad
 * digest leaves the `.part` behind and never a truncated file under the
 * final name.
 */
export async function downloadDumpTo(
	file: StreamsDumpFile,
	dest: string,
	fetchImpl: typeof fetch,
	url: string,
): Promise<number> {
	const res = await fetchImpl(url);
	if (!res.ok || !res.body) {
		throw new Error(`could not download dump ${file.path} (${res.status})`);
	}
	await mkdir(dirname(dest), { recursive: true });
	const part = `${dest}.part`;
	const hash = createHash("sha256");
	let bytes = 0;
	const handle = await open(part, "w");
	try {
		const reader = res.body.getReader();
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			hash.update(value);
			bytes += value.byteLength;
			await handle.write(value);
		}
	} finally {
		await handle.close();
	}
	const digest = hash.digest("hex");
	if (digest !== file.sha256) {
		throw new Error(
			`dump ${file.path} sha256 mismatch (expected ${file.sha256}, got ${digest}); partial file left at ${part}`,
		);
	}
	await rename(part, dest);
	return bytes;
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

/** `--max-pages` bounds a run; a value that is not a count would otherwise
 *  make the loop stop before its first page and exit 0 with nothing
 *  streamed, which reads as success. */
export function parseMaxPages(value?: string): number | undefined {
	if (value === undefined) return undefined;
	const n = Number.parseInt(value, 10);
	if (!Number.isFinite(n) || n < 1 || String(n) !== value.trim()) {
		throw new Error("--max-pages must be a positive integer");
	}
	return n;
}

/**
 * What `streams consume` writes per page and per reorg. Events go to stdout
 * one per line; a reorg is one more line on the same stream, shaped
 * `{"kind":"reorg",...}`, so a reader tailing the file learns that rows at or
 * above `fork_point_height` are no longer canonical and the loop rewinds to
 * re-deliver the canonical ones. The checkpoint printed to stderr is
 * `ctx.cursor`, the position the loop itself resumes from, never the
 * envelope's `next_cursor`.
 */
export function consumeHandlers(io: {
	stdout: (line: string) => void;
	stderr: (line: string) => void;
}): {
	onBatch: (
		events: StreamsEvent[],
		envelope: StreamsEventsEnvelope,
		ctx: StreamsBatchContext,
	) => void;
	onReorg: (reorg: StreamsReorg, ctx: StreamsReorgContext) => void;
} {
	return {
		onBatch: (events, _envelope, ctx) => {
			for (const e of events) io.stdout(JSON.stringify(e));
			if (ctx.cursor) io.stderr(`# next_cursor=${ctx.cursor}`);
		},
		onReorg: (reorg, ctx) => {
			io.stdout(JSON.stringify({ kind: "reorg", ...reorg }));
			io.stderr(
				`# reorg at ${reorg.fork_point_height}; rewinding to ${ctx.cursor}`,
			);
		},
	};
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
		.description("Read raw chain events from Streams");

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
		.option(
			"--event-type <type>",
			"alias for a single-value --types (the Index spelling)",
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
  $ secondlayer streams events --types stx_transfer,print --limit 50
  $ secondlayer streams events --not-types print --contract-id SP00....token,SP01....token
  $ secondlayer streams events --sender SP1...,SP2... --from-block 150000 --to-block 160000
  $ secondlayer streams events --cursor 150000:3`,
		)
		.action(
			async (options: {
				types?: string;
				eventType?: string;
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
						types: parseTypes(options.types ?? options.eventType),
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
  $ secondlayer streams consume --types print --cursor 150000:0
  $ secondlayer streams consume --not-types print --sender SP1...,SP2... --batch-size 500 --max-pages 10`,
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
					const maxPages = parseMaxPages(options.maxPages);
					note(
						'# streaming events to stdout (jsonl); reorgs appear inline as {"kind":"reorg"}; next_cursor printed to stderr',
					);
					const handlers = consumeHandlers({
						stdout: (line) => process.stdout.write(`${line}\n`),
						stderr: (line) => process.stderr.write(`${line}\n`),
					});
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
						onBatch: handlers.onBatch,
						onReorg: handlers.onReorg,
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

	// --- dumps ---
	const runDumps = async (options: {
		to: string;
		dumpsUrl?: string;
		fromBlock?: string;
		toBlock?: string;
	}): Promise<void> => {
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
				const dest = resolveDumpDest(options.to, file.path);
				const bytes = await downloadDumpTo(
					file,
					dest,
					fetch,
					dumps.fileUrl(file),
				);
				process.stderr.write(
					`# ${file.path} (${file.row_count} rows, ${bytes} bytes)\n`,
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
	};

	streams
		.command("dumps")
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
  $ secondlayer streams dumps --to ./dump
  $ secondlayer streams dumps --to ./dump --from-block 150000 --to-block 200000`,
		)
		.action(runDumps);

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
