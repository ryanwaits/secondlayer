/**
 * One-time backfill of sBTC decoded rows from the canonical event firehose —
 * in-process, NOT over the Streams HTTP API.
 *
 * Why: the live sBTC L2 decoders (l2.sbtc.v1 / l2.sbtc_token.v1) consume Streams
 * over HTTP, which is retention-gated and refuses ranges older than the caller's
 * tier — so a fresh decoder checkpoint floors at the recent window (~block 7.9M).
 * The same canonical reader the HTTP route wraps (`readCanonicalStreamsEvents`)
 * has no retention gate when called directly against the source DB, and it emits
 * the SAME computed stream cursors the live path uses. So we replay the firehose
 * from our ingestion floor (~7.44M) through the exact same decode functions,
 * producing rows with cursors identical to the live decoder's — idempotent
 * (upsert on cursor) and safe to overlap. NB: our `events` table itself only
 * holds sBTC back to ~7.44M; reaching true chain genesis (~328k) needs a separate
 * node replay. This extends coverage to the full extent of what we ingested.
 *
 * It does NOT touch the live decoder checkpoints — the live consumer keeps owning
 * the tip and writes the same rows identically where ranges overlap.
 *
 * Usage:
 *   bun run packages/indexer/src/l2/backfill-sbtc-from-decoded.ts \
 *     --target events            # events | token | both  (default: events)
 *     [--from-height N] [--to-height N] [--limit 500] [--apply]
 *
 * Default is a DRY RUN (decode + count + sample, no writes). Pass --apply to write.
 */

import type { StreamsEvent, StreamsEventType } from "@secondlayer/sdk";
import { getSourceDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import { logger } from "@secondlayer/shared/logger";
import { SBTC_CONTRACTS } from "@secondlayer/stacks/sbtc";
import type { Kysely } from "kysely";
import {
	type ReadCanonicalStreamsEventsParams,
	type ReadCanonicalStreamsEventsResult,
	readCanonicalStreamsEvents,
} from "../streams-events.ts";
import { decodeRegistryPrint, decodeTokenEvent } from "./decoders/sbtc.ts";
import {
	SBTC_DECODER_NAME,
	SBTC_TOKEN_DECODER_NAME,
	type SbtcEventRow,
	type SbtcTokenEventRow,
	writeSbtcEvents,
	writeSbtcTokenEvents,
} from "./sbtc-storage.ts";

type Target = "events" | "token" | "both";

type EventsReader = (
	params: ReadCanonicalStreamsEventsParams,
) => Promise<ReadCanonicalStreamsEventsResult>;

export type BackfillDeps = {
	readEvents?: EventsReader;
	writeEvents?: typeof writeSbtcEvents;
	writeTokens?: typeof writeSbtcTokenEvents;
	db?: Kysely<Database>;
	network?: "mainnet" | "testnet";
};

export type BackfillStats = {
	scanned: number;
	eventsWritten: number;
	tokenWritten: number;
	topics: Record<string, number>;
};

function parseCursor(cursor: string): {
	block_height: number;
	event_index: number;
} {
	const [bh, ei] = cursor.split(":");
	return { block_height: Number(bh), event_index: Number(ei) };
}

/**
 * Replay one firehose stream (a type set + contract filter) through a decode fn,
 * writing decoded rows. Generic over registry-prints and token-ft so both share
 * the cursor-walk + idempotent-write loop.
 */
async function runStream<Row extends { cursor: string }>(opts: {
	read: EventsReader;
	types: readonly StreamsEventType[];
	contractId: string;
	fromHeight: number;
	toHeight: number;
	limit: number;
	maxBatches: number;
	decode: (event: StreamsEvent) => Row | null;
	write: (rows: Row[]) => Promise<void>;
	apply: boolean;
	onDecoded?: (row: Row) => void;
}): Promise<{ scanned: number; written: number }> {
	let after: { block_height: number; event_index: number } | undefined;
	let scanned = 0;
	let written = 0;
	let batches = 0;
	for (;;) {
		if (batches >= opts.maxBatches) break;
		const page = await opts.read({
			after,
			fromHeight: after ? undefined : opts.fromHeight,
			toHeight: opts.toHeight,
			types: opts.types,
			contractId: opts.contractId,
			limit: opts.limit,
		});
		batches += 1;
		scanned += page.events.length;

		const rows: Row[] = [];
		for (const event of page.events) {
			// The canonical reader emits the indexer's StreamsEvent; the decoders
			// take the SDK's structurally-identical StreamsEvent. Bridge the nominal
			// type gap — every field the decoders read is present at runtime.
			const row = opts.decode(event as unknown as StreamsEvent);
			if (row) {
				rows.push(row);
				opts.onDecoded?.(row);
			}
		}
		if (opts.apply && rows.length) await opts.write(rows);
		written += rows.length;

		if (!page.next_cursor) break;
		const next = parseCursor(page.next_cursor);
		// Empty page whose cursor has advanced to/past the ceiling = end of range.
		if (page.events.length === 0 && next.block_height >= opts.toHeight) break;
		after = next;
	}
	return { scanned, written };
}

export async function backfillSbtc(opts: {
	target: Target;
	apply: boolean;
	fromHeight: number;
	toHeight: number;
	limit: number;
	maxBatches: number;
	deps?: BackfillDeps;
}): Promise<BackfillStats> {
	const deps = opts.deps ?? {};
	const db = deps.db ?? getSourceDb();
	const read: EventsReader =
		deps.readEvents ??
		((params) => readCanonicalStreamsEvents({ ...params, db }));
	const writeEvents = deps.writeEvents ?? writeSbtcEvents;
	const writeTokens = deps.writeTokens ?? writeSbtcTokenEvents;
	const net =
		deps.network ??
		(process.env.STACKS_NETWORK === "testnet" ? "testnet" : "mainnet");
	const registry = `${SBTC_CONTRACTS[net].address}.${SBTC_CONTRACTS[net].registry}`;
	const token = `${SBTC_CONTRACTS[net].address}.${SBTC_CONTRACTS[net].token}`;

	const topics: Record<string, number> = {};
	let eventsWritten = 0;
	let tokenWritten = 0;
	let scanned = 0;

	if (opts.target === "events" || opts.target === "both") {
		const r = await runStream<SbtcEventRow>({
			read,
			types: ["print"],
			contractId: registry,
			fromHeight: opts.fromHeight,
			toHeight: opts.toHeight,
			limit: opts.limit,
			maxBatches: opts.maxBatches,
			decode: decodeRegistryPrint,
			write: (rows) => writeEvents(rows, { db }),
			apply: opts.apply,
			onDecoded: (row) => {
				topics[row.topic] = (topics[row.topic] ?? 0) + 1;
			},
		});
		scanned += r.scanned;
		eventsWritten += r.written;
	}

	if (opts.target === "token" || opts.target === "both") {
		const r = await runStream<SbtcTokenEventRow>({
			read,
			types: ["ft_mint", "ft_burn", "ft_transfer"],
			contractId: token,
			fromHeight: opts.fromHeight,
			toHeight: opts.toHeight,
			limit: opts.limit,
			maxBatches: opts.maxBatches,
			decode: decodeTokenEvent,
			write: (rows) => writeTokens(rows, { db }),
			apply: opts.apply,
		});
		scanned += r.scanned;
		tokenWritten += r.written;
	}

	return { scanned, eventsWritten, tokenWritten, topics };
}

async function resolveTip(db: Kysely<Database>): Promise<number> {
	const { rows } = await sql<{ tip: string | number | null }>`
		SELECT max(height) AS tip FROM blocks WHERE canonical = true
	`.execute(db);
	return Number(rows[0]?.tip ?? 0);
}

async function main() {
	const args = process.argv.slice(2);
	const flag = (name: string) => {
		const i = args.indexOf(name);
		return i >= 0 ? args[i + 1] : undefined;
	};
	const target = (flag("--target") ?? "events") as Target;
	const apply = args.includes("--apply");
	const fromHeight = Number(flag("--from-height") ?? 0);
	const limit = Number(flag("--limit") ?? 500);
	const maxBatches = Number(flag("--max-batches") ?? Number.MAX_SAFE_INTEGER);

	if (!["events", "token", "both"].includes(target)) {
		throw new Error(`--target must be events|token|both, got ${target}`);
	}

	const db = getSourceDb();
	const toHeight = Number(flag("--to-height") ?? (await resolveTip(db)));
	logger.info("sbtc_backfill.start", {
		target,
		apply,
		fromHeight,
		toHeight,
		limit,
	});

	const stats = await backfillSbtc({
		target,
		apply,
		fromHeight,
		toHeight,
		limit,
		maxBatches,
		deps: { db },
	});

	logger.info("sbtc_backfill.done", {
		target,
		apply,
		...stats,
		note: apply ? "rows upserted" : "DRY RUN — no writes (pass --apply)",
	});

	// The live decoders keep their own checkpoints; we never advance/reset them
	// here. Reference the names so the dependency is explicit for future edits.
	void SBTC_DECODER_NAME;
	void SBTC_TOKEN_DECODER_NAME;

	await db.destroy();
}

if (import.meta.main) {
	main().catch((err) => {
		logger.error("sbtc_backfill.failed", { error: String(err) });
		process.exit(1);
	});
}
