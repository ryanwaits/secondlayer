/**
 * Universal genesis backfill for L2 decoder tables — replays the full-genesis
 * indexer firehose through the SAME decode functions the live decoders use.
 *
 * Architecture: indexer DB (full genesis: blocks/transactions/events) → Streams →
 * Index → Subgraphs. Some Index-layer domain decoders were added AFTER Streams
 * and only ran from a recent checkpoint (~7.9M), so their tables are recent-only
 * even though the firehose holds the data from genesis. (The bulk dumps are a
 * separate analytics export — no product reads them, and this tool never touches
 * them.) `readCanonicalStreamsEvents` reads the indexer DB in-process with no
 * retention gate and emits live-identical cursors, so replaying it genesis→tip
 * fills each lagging table with no gaps, idempotently (upsert on cursor).
 *
 * Decoders are registered EXPLICITLY (no auto-discovery) so each backfill is a
 * deliberate, reviewed entry. Already-genesis decoders (pox4, bns name/namespace,
 * and the general ft/nft/stx/print → decoded_events) are intentionally absent.
 *
 * It does NOT touch live decoder checkpoints — the live consumer keeps owning the
 * tip; overlapping ranges re-write identical rows.
 *
 * Usage:
 *   bun run packages/indexer/src/l2/backfill-from-firehose.ts \
 *     --target sbtc            # a registry key, or "all"
 *     [--from-height N] [--to-height N] [--limit 500] [--apply]
 *
 * Default is a DRY RUN (decode + count, no writes). Pass --apply to write.
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

type Network = "mainnet" | "testnet";

export type EventsReader = (
	params: ReadCanonicalStreamsEventsParams,
) => Promise<ReadCanonicalStreamsEventsResult>;

type ProcessCtx = { apply: boolean; db: Kysely<Database> };
type ProcessResult = { written: number; topics?: Record<string, number> };

/** An explicitly-registered decoder backfill: a firehose filter + decode/write. */
export type BackfillEntry = {
	key: string;
	decoderName: string;
	types: readonly StreamsEventType[];
	contractId: (net: Network) => string;
	/** Decode a page of firehose events and (when apply) write the rows. */
	process: (events: StreamsEvent[], ctx: ProcessCtx) => Promise<ProcessResult>;
};

const sbtcEntry: BackfillEntry = {
	key: "sbtc",
	decoderName: SBTC_DECODER_NAME,
	types: ["print"],
	contractId: (net) =>
		`${SBTC_CONTRACTS[net].address}.${SBTC_CONTRACTS[net].registry}`,
	process: async (events, ctx) => {
		const rows: SbtcEventRow[] = [];
		const topics: Record<string, number> = {};
		for (const event of events) {
			const row = decodeRegistryPrint(event);
			if (row) {
				rows.push(row);
				topics[row.topic] = (topics[row.topic] ?? 0) + 1;
			}
		}
		if (ctx.apply && rows.length) await writeSbtcEvents(rows, { db: ctx.db });
		return { written: rows.length, topics };
	},
};

const sbtcTokenEntry: BackfillEntry = {
	key: "sbtc_token",
	decoderName: SBTC_TOKEN_DECODER_NAME,
	types: ["ft_mint", "ft_burn", "ft_transfer"],
	contractId: (net) =>
		`${SBTC_CONTRACTS[net].address}.${SBTC_CONTRACTS[net].token}`,
	process: async (events, ctx) => {
		const rows: SbtcTokenEventRow[] = [];
		for (const event of events) {
			const row = decodeTokenEvent(event);
			if (row) rows.push(row);
		}
		if (ctx.apply && rows.length)
			await writeSbtcTokenEvents(rows, { db: ctx.db });
		return { written: rows.length };
	},
};

/** The explicit registry — only decoders whose tables are recent-only. */
export const BACKFILL_REGISTRY: readonly BackfillEntry[] = [
	sbtcEntry,
	sbtcTokenEntry,
];

function parseCursor(cursor: string): {
	block_height: number;
	event_index: number;
} {
	const [bh, ei] = cursor.split(":");
	return { block_height: Number(bh), event_index: Number(ei) };
}

export type RunEntryStats = {
	key: string;
	scanned: number;
	written: number;
	topics: Record<string, number>;
};

/** Cursor-walk the firehose for one registry entry, decoding + writing per page. */
export async function runEntry(
	entry: BackfillEntry,
	opts: {
		read: EventsReader;
		db: Kysely<Database>;
		net: Network;
		fromHeight: number;
		toHeight: number;
		limit: number;
		maxBatches: number;
		apply: boolean;
	},
): Promise<RunEntryStats> {
	let after: { block_height: number; event_index: number } | undefined;
	let scanned = 0;
	let written = 0;
	let batches = 0;
	const topics: Record<string, number> = {};
	const contractId = entry.contractId(opts.net);

	for (;;) {
		if (batches >= opts.maxBatches) break;
		const page = await opts.read({
			after,
			fromHeight: after ? undefined : opts.fromHeight,
			toHeight: opts.toHeight,
			types: entry.types,
			contractId,
			limit: opts.limit,
		});
		batches += 1;
		scanned += page.events.length;

		const result = await entry.process(page.events as StreamsEvent[], {
			apply: opts.apply,
			db: opts.db,
		});
		written += result.written;
		for (const [topic, n] of Object.entries(result.topics ?? {})) {
			topics[topic] = (topics[topic] ?? 0) + n;
		}

		if (batches % 50 === 0) {
			logger.info("backfill.progress", {
				key: entry.key,
				batches,
				scanned,
				written,
				atHeight: after?.block_height ?? opts.fromHeight,
			});
		}

		if (!page.next_cursor) break;
		const next = parseCursor(page.next_cursor);
		if (page.events.length === 0 && next.block_height >= opts.toHeight) break;
		after = next;
	}
	return { key: entry.key, scanned, written, topics };
}

export async function backfillFromFirehose(opts: {
	target: string; // a registry key or "all"
	apply: boolean;
	fromHeight: number;
	toHeight: number;
	limit: number;
	maxBatches: number;
	deps?: { read?: EventsReader; db?: Kysely<Database>; net?: Network };
}): Promise<RunEntryStats[]> {
	const db = opts.deps?.db ?? getSourceDb();
	const read: EventsReader =
		opts.deps?.read ??
		((params) => readCanonicalStreamsEvents({ ...params, db }));
	const net =
		opts.deps?.net ??
		(process.env.STACKS_NETWORK === "testnet" ? "testnet" : "mainnet");

	const entries =
		opts.target === "all"
			? BACKFILL_REGISTRY
			: BACKFILL_REGISTRY.filter((e) => e.key === opts.target);
	if (entries.length === 0) {
		throw new Error(
			`unknown --target ${opts.target}; known: ${BACKFILL_REGISTRY.map((e) => e.key).join(", ")}, all`,
		);
	}

	const stats: RunEntryStats[] = [];
	for (const entry of entries) {
		stats.push(
			await runEntry(entry, {
				read,
				db,
				net,
				fromHeight: opts.fromHeight,
				toHeight: opts.toHeight,
				limit: opts.limit,
				maxBatches: opts.maxBatches,
				apply: opts.apply,
			}),
		);
	}
	return stats;
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
	const target = flag("--target") ?? "sbtc";
	const apply = args.includes("--apply");
	const fromHeight = Number(flag("--from-height") ?? 0);
	const limit = Number(flag("--limit") ?? 500);
	const maxBatches = Number(flag("--max-batches") ?? Number.MAX_SAFE_INTEGER);

	const db = getSourceDb();
	const toHeight = Number(flag("--to-height") ?? (await resolveTip(db)));
	logger.info("backfill.start", { target, apply, fromHeight, toHeight, limit });

	const stats = await backfillFromFirehose({
		target,
		apply,
		fromHeight,
		toHeight,
		limit,
		maxBatches,
		deps: { db },
	});

	logger.info("backfill.done", {
		target,
		apply,
		stats,
		note: apply ? "rows upserted" : "DRY RUN — no writes (pass --apply)",
	});

	await db.destroy();
}

if (import.meta.main) {
	main().catch((err) => {
		logger.error("backfill.failed", { error: String(err) });
		process.exit(1);
	});
}
