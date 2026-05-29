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

function parseTypes(value?: string): StreamsEventType[] | undefined {
	if (!value) return undefined;
	const parts = value.split(",").map((s) => s.trim());
	for (const p of parts) {
		if (!VALID_TYPES.includes(p as StreamsEventType)) {
			throw new Error(
				`invalid --types value "${p}"; expected one of: ${VALID_TYPES.join(", ")}`,
			);
		}
	}
	return parts as StreamsEventType[];
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
		.action(async () => {
			try {
				const tip: StreamsTip = await client().tip();
				writeData(JSON.stringify(tip, null, 2));
			} catch (err) {
				logError(err instanceof Error ? err.message : String(err));
				process.exit(1);
			}
		});

	streams
		.command("events")
		.description("List events (cursor-paginated; one page per call)")
		.option(
			"--types <types>",
			`comma-separated event types (${VALID_TYPES.join(", ")})`,
		)
		.option("--contract-id <id>", "filter to a single contract identifier")
		.option("--cursor <cursor>", "start cursor (block_height:event_index)")
		.option("--from-height <n>", "filter to blocks >= n")
		.option("--to-height <n>", "filter to blocks <= n")
		.option("--limit <n>", "page size (1-1000, default 100)", "100")
		.addHelpText(
			"after",
			`
Examples:
  $ sl streams events --types stx_transfer,print --limit 50
  $ sl streams events --contract-id SP00....token --from-height 150000 --to-height 160000
  $ sl streams events --cursor 150000:3`,
		)
		.action(
			async (options: {
				types?: string;
				contractId?: string;
				cursor?: string;
				fromHeight?: string;
				toHeight?: string;
				limit?: string;
			}) => {
				try {
					const envelope: StreamsEventsEnvelope = await client().events.list({
						types: parseTypes(options.types),
						contractId: options.contractId,
						cursor: options.cursor,
						fromHeight: parseHeight(options.fromHeight, "--from-height"),
						toHeight: parseHeight(options.toHeight, "--to-height"),
						limit: parseLimit(options.limit),
					});
					writeData(JSON.stringify(envelope, null, 2));
				} catch (err) {
					logError(err instanceof Error ? err.message : String(err));
					process.exit(1);
				}
			},
		);

	streams
		.command("consume")
		.description(
			"Long-running pull from a cursor; emits one event per line (jsonl) until SIGINT or --max-pages",
		)
		.option(
			"--types <types>",
			`comma-separated event types (${VALID_TYPES.join(", ")})`,
		)
		.option("--contract-id <id>", "filter to a single contract identifier")
		.option("--cursor <cursor>", "start cursor (block_height:event_index)")
		.option("--batch-size <n>", "events per batch (1-1000, default 100)", "100")
		.option("--max-pages <n>", "stop after N pages (default: run until SIGINT)")
		.addHelpText(
			"after",
			`
Examples:
  $ sl streams consume --types print --cursor 150000:0
  $ sl streams consume --types stx_transfer --batch-size 500 --max-pages 10`,
		)
		.action(
			async (options: {
				types?: string;
				contractId?: string;
				cursor?: string;
				batchSize?: string;
				maxPages?: string;
			}) => {
				try {
					const types = parseTypes(options.types);
					const batchSize = parseLimit(options.batchSize) ?? 100;
					const maxPages = options.maxPages
						? Number.parseInt(options.maxPages, 10)
						: undefined;
					note(
						"# streaming events to stdout (jsonl); next_cursor printed to stderr",
					);
					await client().events.consume({
						fromCursor: options.cursor,
						types,
						contractId: options.contractId,
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
		.command("canonical <height>")
		.description("Canonical block metadata at a given height")
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
}
