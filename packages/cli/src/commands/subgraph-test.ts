import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Index } from "@secondlayer/sdk";
import type { IndexEvent } from "@secondlayer/sdk";
import {
	DECODED_EVENT_TYPES,
	type DecodedEventType,
} from "@secondlayer/stacks/filters";
import { error, info, success, warn } from "../lib/output.ts";

/**
 * `sl subgraphs test` — run a subgraph's handlers against real chain data
 * WITHOUT deploying.
 *
 * The verb is `test`, not `replay`: `replay` already means "re-deliver
 * historical rows to a webhook" in two places in this CLI
 * (`sl subscriptions replay`, `@secondlayer/subgraphs/runtime/replay`), and
 * overloading it would be a third meaning for the same word.
 *
 * Until now the only feedback loop was production, and it showed: three of
 * four production subgraphs shipped broken, one holding 0 rows chain-wide
 * for a whole release because of a 3-line field-mapping bug.
 *
 * Reads are metered, so a range is REQUIRED and results are recorded to a
 * cassette. The cassette is keyed by the source filters and the decoder
 * version — change either and it is discarded rather than silently passing
 * against data the subgraph would no longer request.
 */

const CASSETTE_DIR = "cassettes";
/** Bump when the decoded row shape changes; invalidates every cassette. */
const DECODER_VERSION = 1;

interface Cassette {
	decoderVersion: number;
	filterHash: string;
	subgraph: string;
	fromHeight: number;
	toHeight: number;
	recordedAt: string;
	/** Events per source name, in chain order. */
	events: Record<string, IndexEvent[]>;
}

function filterHashOf(sources: Record<string, unknown>): string {
	// Stable across key order so a cosmetic reshuffle doesn't invalidate.
	const stable = JSON.stringify(
		Object.fromEntries(
			Object.entries(sources).sort(([a], [b]) => a.localeCompare(b)),
		),
		(_k, v) => (typeof v === "bigint" ? `${v}n` : v),
	);
	return createHash("sha256").update(stable).digest("hex").slice(0, 16);
}

function cassettePath(name: string): string {
	return resolve(CASSETTE_DIR, `${name}.json`);
}

function loadCassette(
	name: string,
	filterHash: string,
): Cassette | { stale: string } | null {
	const path = cassettePath(name);
	if (!existsSync(path)) return null;
	let parsed: Cassette;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8")) as Cassette;
	} catch {
		return { stale: "unreadable" };
	}
	if (parsed.decoderVersion !== DECODER_VERSION) {
		return { stale: `recorded by decoder v${parsed.decoderVersion}` };
	}
	if (parsed.filterHash !== filterHash) {
		// The critical check: passing against events the subgraph would no
		// longer request is worse than no cassette at all.
		return { stale: "sources changed since it was recorded" };
	}
	return parsed;
}

/** Index event types a source filter maps onto, or null when unsupported. */
/**
 * Subgraph source type → the `event_type` `/v1/index/events` accepts, or null
 * when the source isn't an events read at all.
 *
 * Validated against the canonical decoded vocabulary rather than returned as a
 * bare `string`: this used to hand back `string` and the call site cast it with
 * `as any`, so a source type the Index API doesn't serve would have sailed
 * through to a 400 at runtime.
 */
function eventTypeFor(filter: { type: string }): DecodedEventType | null {
	if (filter.type === "contract_call" || filter.type === "contract_deploy") {
		return null; // separate endpoint / not an events read
	}
	const candidate = filter.type === "print_event" ? "print" : filter.type;
	return DECODED_EVENT_TYPES.includes(candidate as DecodedEventType)
		? (candidate as DecodedEventType)
		: null;
}

export interface SubgraphTestOptions {
	from?: string;
	to?: string;
	record?: boolean;
	offline?: boolean;
	limit?: string;
}

export async function runSubgraphTest(
	file: string,
	options: SubgraphTestOptions,
): Promise<void> {
	const absPath = resolve(file);
	if (!existsSync(absPath)) {
		error(`File not found: ${absPath}`);
		process.exit(1);
	}

	const { readFile } = await import("node:fs/promises");
	const { bundleSubgraphCode } = await import("@secondlayer/bundler");
	const { createTestContext, buildEvent } = await import(
		"@secondlayer/subgraphs/testing"
	);

	const source = await readFile(absPath, "utf8");
	const bundled = await bundleSubgraphCode(source);
	const sources = (bundled.sources ?? {}) as Record<
		string,
		{ type: string; contractId?: string | string[]; topic?: string }
	>;
	const filterHash = filterHashOf(sources);

	// Handlers must come from the LOCAL file — running the deployed bundle
	// would defeat the purpose.
	const mod = (await import(`${absPath}?t=${Date.now()}`)) as {
		default?: { handlers?: Record<string, unknown>; schema?: unknown };
	};
	const def = mod.default;
	if (!def?.handlers || !def.schema) {
		error(
			"File must default-export a defineSubgraph() definition with handlers and schema.",
		);
		process.exit(1);
	}

	const cached = loadCassette(bundled.name, filterHash);
	if (cached && "stale" in cached) {
		warn(`Cassette discarded (${cached.stale}) — re-recording.`);
	}
	const usable = cached && !("stale" in cached) ? cached : null;

	let events: Record<string, IndexEvent[]>;
	let fromHeight: number;
	let toHeight: number;

	if (usable && options.offline !== false && !options.from) {
		info(
			`Replaying cassette: blocks ${usable.fromHeight}–${usable.toHeight}, recorded ${usable.recordedAt}`,
		);
		events = usable.events;
		fromHeight = usable.fromHeight;
		toHeight = usable.toHeight;
	} else {
		if (options.offline) {
			error(
				"No usable cassette for --offline. Record one first: sl subgraphs test <file> --from <h> --to <h>",
			);
			process.exit(1);
		}
		if (!options.from) {
			error(
				"--from <height> is required for the first run (Index reads are metered). Later runs replay the cassette.",
			);
			process.exit(1);
		}
		fromHeight = Number(options.from);
		// Bounded by default: an unbounded sweep from a genesis height would
		// bill for the whole chain.
		toHeight = options.to ? Number(options.to) : fromHeight + 100;
		if (!Number.isInteger(fromHeight) || !Number.isInteger(toHeight)) {
			error("--from/--to must be integers.");
			process.exit(1);
		}
		const limit = options.limit ? Number(options.limit) : 500;

		const index = new Index();
		events = {};
		for (const [name, filter] of Object.entries(sources)) {
			const eventType = eventTypeFor(filter);
			if (eventType === null) {
				warn(
					`source "${name}" (${filter.type}) is not readable from index.events — skipped.`,
				);
				continue;
			}
			info(`Fetching ${name} (${eventType}) blocks ${fromHeight}–${toHeight}…`);
			try {
				const envelope = await index.events.list({
					eventType,
					...(filter.contractId
						? {
								contractId: Array.isArray(filter.contractId)
									? filter.contractId
									: filter.contractId,
							}
						: {}),
					fromHeight,
					toHeight,
					limit,
				});
				events[name] = envelope.events;
			} catch (err) {
				// The common first-run failure is reading below the free window.
				// Say what to do instead of printing a stack.
				const e = err as { status?: number; body?: { details?: unknown } };
				if (e?.status === 402) {
					const details = e.body?.details as
						| { oldest_seekable_height?: number }
						| undefined;
					error(
						`Blocks ${fromHeight}–${toHeight} are below the free read window.${
							details?.oldest_seekable_height
								? ` Try --from ${details.oldest_seekable_height}, or add a paid API key (SL_API_KEY) to test against older history.`
								: " Add a paid API key (SL_API_KEY) to test against older history."
						}`,
					);
					process.exit(1);
				}
				throw err;
			}
		}

		if (options.record !== false) {
			const cassette: Cassette = {
				decoderVersion: DECODER_VERSION,
				filterHash,
				subgraph: bundled.name,
				fromHeight,
				toHeight,
				recordedAt: new Date().toISOString(),
				events,
			};
			const path = cassettePath(bundled.name);
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(
				path,
				`${JSON.stringify(cassette, (_k, v) => (typeof v === "bigint" ? `${v}n` : v), 2)}\n`,
			);
			info(`Recorded cassette → ${path}`);
		}
	}

	// ── Run the LOCAL handlers ─────────────────────────────────────────
	const ctx = createTestContext(
		def.schema as Parameters<typeof createTestContext>[0],
	);
	let applied = 0;
	let failed = 0;
	const failures: string[] = [];

	for (const [name, rows] of Object.entries(events)) {
		const handler =
			(def.handlers as Record<string, unknown>)[name] ??
			(def.handlers as Record<string, unknown>)["*"];
		if (typeof handler !== "function") {
			warn(`source "${name}": no handler — skipped.`);
			continue;
		}
		const filter = sources[name];
		for (const row of rows) {
			// Post-decode topic filter, exactly as the runner applies it.
			const payload = toHandlerPayload(filter, row);
			if (
				filter?.type === "print_event" &&
				filter.topic &&
				(payload as { topic?: string }).topic !== filter.topic
			) {
				continue;
			}
			try {
				await (handler as (e: unknown, c: unknown) => unknown)(
					buildEvent(
						filter as Parameters<typeof buildEvent>[0],
						payload as Record<string, unknown>,
					),
					ctx,
				);
				applied++;
			} catch (err) {
				failed++;
				if (failures.length < 5) {
					failures.push(
						`  ${name} @ ${row.cursor}: ${err instanceof Error ? err.message : String(err)}`,
					);
				}
			}
		}
	}

	// ── Report ─────────────────────────────────────────────────────────
	info("");
	const tables = Object.keys(def.schema as Record<string, unknown>);
	let totalRows = 0;
	for (const table of tables) {
		const rows = await ctx.rows(table as never);
		totalRows += rows.length;
		info(`  ${table.padEnd(24)} ${String(rows.length).padStart(6)} rows`);
		const sample = rows[0];
		if (sample) {
			const preview = Object.entries(sample)
				.filter(([k]) => !k.startsWith("_"))
				.slice(0, 4)
				.map(([k, v]) => `${k}=${String(v).slice(0, 24)}`)
				.join("  ");
			info(`  ${"".padEnd(24)} ${preview}`);
		}
	}
	info("");
	if (failed > 0) {
		warn(`${failed} handler error${failed === 1 ? "" : "s"}:`);
		for (const f of failures) warn(f);
	}

	const fetched = Object.values(events).reduce((n, r) => n + r.length, 0);
	if (fetched === 0) {
		// Nothing matched in this range — not a handler defect. Widen the range
		// rather than reporting a failure that isn't one.
		warn(
			`No events matched these sources in blocks ${fromHeight}–${toHeight}. Widen the range (--to) or check the source filters.`,
		);
		return;
	}
	// Events arrived and the handlers wrote nothing: that IS the bns-names
	// failure mode (0 rows chain-wide while tailing happily at the tip).
	if (totalRows === 0) {
		error(
			`${applied} event${applied === 1 ? "" : "s"} applied, but NO rows were written — the shape of the field-mapping bug that shipped a 0-row subgraph. Check your handler's field names against the payload.`,
		);
		process.exit(1);
	}
	success(
		`${applied} event${applied === 1 ? "" : "s"} → ${totalRows} row${totalRows === 1 ? "" : "s"} across ${tables.length} table${tables.length === 1 ? "" : "s"} (blocks ${fromHeight}–${toHeight})`,
	);
}

/** Map an Index row onto the payload shape a handler expects. */
function toHandlerPayload(
	_filter: { type: string } | undefined,
	row: IndexEvent,
): Record<string, unknown> {
	if (row.event_type === "print") {
		const payload = row.payload as { topic?: string | null; value?: unknown };
		return {
			contractId: row.contract_id ?? "",
			topic: payload?.topic ?? "",
			data: (payload?.value as Record<string, unknown>) ?? {},
		};
	}
	// Token/STX events: the Index row is already flat and camel-free; map the
	// snake_case wire names onto the handler payload names.
	const r = row as unknown as Record<string, unknown>;
	return {
		...(r.sender !== undefined ? { sender: r.sender } : {}),
		...(r.recipient !== undefined ? { recipient: r.recipient } : {}),
		...(r.amount !== undefined ? { amount: BigInt(String(r.amount)) } : {}),
		...(r.asset_identifier !== undefined
			? { assetIdentifier: r.asset_identifier }
			: {}),
		...(r.value !== undefined ? { tokenId: r.value } : {}),
	};
}
