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
 * deliberate, reviewed entry. Genuinely-genesis decoders are absent: pox4, bns,
 * sbtc (cover from contract deploy) and ft_transfer/ft_mint/ft_burn → decoded_events.
 * The other generic decoders (stx_*, nft_*, print) were NOT genesis — they were
 * added go-forward and floored at ~6.8M (audit 2026-06-20), so they ARE registered
 * here now. (Earlier this comment wrongly claimed all generic decoders were
 * already-genesis, which hid the gap.)
 *
 * It does NOT touch live decoder checkpoints — the live consumer keeps owning the
 * tip; overlapping ranges re-write identical rows.
 *
 * Usage:
 *   bun run packages/indexer/src/decode/backfill-from-firehose.ts \
 *     --target sbtc            # a registry key, or "all"
 *     [--from-height N] [--to-height N] [--limit 500] [--apply]
 *
 * Default is a DRY RUN (decode + count, no writes). Pass --apply to write.
 */

import {
	type DecodedEventRow,
	type StreamsEvent,
	type StreamsEventType,
	decodeNftBurn,
	decodeNftMint,
	decodeNftTransfer,
	decodeStxBurn,
	decodeStxLock,
	decodeStxMint,
	decodeStxTransfer,
} from "@secondlayer/sdk";
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
import {
	NFT_BURN_DECODER_NAME,
	NFT_MINT_DECODER_NAME,
	NFT_TRANSFER_DECODER_NAME,
	STX_BURN_DECODER_NAME,
	STX_LOCK_DECODER_NAME,
	STX_MINT_DECODER_NAME,
	STX_TRANSFER_DECODER_NAME,
	readDecoderCheckpoint,
	writeDecodedEvents,
	writeDecoderCheckpoint,
} from "./storage.ts";

/** Backfill progress is checkpointed under its own namespace so it survives an
 *  interruption (deploy/recreate, OOM, reboot) and resumes instead of restarting
 *  from genesis — and never collides with the live decoder's checkpoint. */
const checkpointName = (key: string) => `backfill.${key}`;

export type CheckpointReader = (name: string) => Promise<string | null>;
export type CheckpointWriter = (name: string, cursor: string) => Promise<void>;

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
	/** Firehose contract filter. OMIT for generic (all-contract) decoders —
	 *  stx/nft/ft events span every contract, so they filter by event type only. */
	contractId?: (net: Network) => string;
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

/**
 * Generic decoded-event backfill: decode a whole event TYPE across ALL contracts
 * into `decoded_events` (mirrors the live `consumeDecodedEvents` path). No
 * contractId — these decoders aren't contract-scoped. Fixes the go-forward
 * decoders (stx/nft *) that were added after the original genesis backfill and
 * never backfilled, so `decoded_events` is recent-only for them (the index
 * service's genesis-completeness contract).
 */
function genericDecodedEntry(
	key: string,
	decoderName: string,
	type: StreamsEventType,
	decode: (event: StreamsEvent) => DecodedEventRow,
): BackfillEntry {
	return {
		key,
		decoderName,
		types: [type],
		process: async (events, ctx) => {
			const rows = events.flatMap((event) => {
				if (event.event_type !== type) return [];
				try {
					return [decode(event)];
				} catch {
					return [];
				}
			});
			if (ctx.apply && rows.length)
				await writeDecodedEvents(rows, { db: ctx.db });
			return { written: rows.length };
		},
	};
}

// The floored generic decoders (audit 2026-06-20): genesis→~6.8M missing from
// decoded_events. ft_transfer/ft_mint/ft_burn are already genesis; print is being
// backfilled separately. These run parallel to live (own checkpoint namespace).
const stxTransferEntry = genericDecodedEntry(
	"stx_transfer",
	STX_TRANSFER_DECODER_NAME,
	"stx_transfer",
	decodeStxTransfer,
);
const stxMintEntry = genericDecodedEntry(
	"stx_mint",
	STX_MINT_DECODER_NAME,
	"stx_mint",
	decodeStxMint,
);
const stxBurnEntry = genericDecodedEntry(
	"stx_burn",
	STX_BURN_DECODER_NAME,
	"stx_burn",
	decodeStxBurn,
);
const stxLockEntry = genericDecodedEntry(
	"stx_lock",
	STX_LOCK_DECODER_NAME,
	"stx_lock",
	decodeStxLock,
);
const nftTransferEntry = genericDecodedEntry(
	"nft_transfer",
	NFT_TRANSFER_DECODER_NAME,
	"nft_transfer",
	decodeNftTransfer,
);
const nftMintEntry = genericDecodedEntry(
	"nft_mint",
	NFT_MINT_DECODER_NAME,
	"nft_mint",
	decodeNftMint,
);
const nftBurnEntry = genericDecodedEntry(
	"nft_burn",
	NFT_BURN_DECODER_NAME,
	"nft_burn",
	decodeNftBurn,
);

/** The explicit registry — only decoders whose tables are recent-only. */
export const BACKFILL_REGISTRY: readonly BackfillEntry[] = [
	sbtcEntry,
	sbtcTokenEntry,
	stxTransferEntry,
	stxMintEntry,
	stxBurnEntry,
	stxLockEntry,
	nftTransferEntry,
	nftMintEntry,
	nftBurnEntry,
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
		/** Resume from a persisted checkpoint if present (default true). */
		resume?: boolean;
		readCheckpoint?: CheckpointReader;
		writeCheckpoint?: CheckpointWriter;
	},
): Promise<RunEntryStats> {
	let after: { block_height: number; event_index: number } | undefined;
	let scanned = 0;
	let written = 0;
	let batches = 0;
	const topics: Record<string, number> = {};
	const contractId = entry.contractId?.(opts.net);
	const cpName = checkpointName(entry.key);
	const readCp =
		opts.readCheckpoint ??
		((name) => readDecoderCheckpoint({ db: opts.db, decoderName: name }));
	const writeCp =
		opts.writeCheckpoint ??
		((name, cursor) =>
			writeDecoderCheckpoint({ db: opts.db, decoderName: name, cursor }));

	// Resume: pick up where a prior (possibly killed) run left off, not genesis.
	// Only for real (apply) runs — a dry-run previews the requested range fresh.
	if (opts.resume !== false && opts.apply) {
		const cp = await readCp(cpName);
		if (cp) {
			after = parseCursor(cp);
			logger.info("backfill.resume", { key: entry.key, fromCursor: cp });
		}
	}

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

		// Dedupe by cursor within the page: a historical reorg can leave a tx in
		// two blocks, so the events⨝transactions join can emit the same event
		// twice. Same cursor ⇒ same decoded row, so last-wins is lossless — and it
		// avoids "ON CONFLICT cannot affect row a second time" on the batch upsert.
		const seen = new Set<string>();
		const uniqueEvents = (page.events as StreamsEvent[]).filter((e) => {
			if (seen.has(e.cursor)) return false;
			seen.add(e.cursor);
			return true;
		});

		const result = await entry.process(uniqueEvents, {
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
		// Checkpoint only after the batch is durably written, recording the cursor
		// we've completed through — a resume re-fetches strictly after it.
		if (opts.apply) await writeCp(cpName, page.next_cursor);
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
	/** Resume from the persisted checkpoint if present (default true). */
	resume?: boolean;
	deps?: {
		read?: EventsReader;
		db?: Kysely<Database>;
		net?: Network;
		readCheckpoint?: CheckpointReader;
		writeCheckpoint?: CheckpointWriter;
	};
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
				resume: opts.resume,
				readCheckpoint: opts.deps?.readCheckpoint,
				writeCheckpoint: opts.deps?.writeCheckpoint,
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
	// Resume from the persisted checkpoint by default; --restart ignores it and
	// re-walks from --from-height (idempotent, but redoes completed work).
	const resume = !args.includes("--restart");
	const fromHeight = Number(flag("--from-height") ?? 0);
	const limit = Number(flag("--limit") ?? 500);
	const maxBatches = Number(flag("--max-batches") ?? Number.MAX_SAFE_INTEGER);

	const db = getSourceDb();
	const toHeight = Number(flag("--to-height") ?? (await resolveTip(db)));
	logger.info("backfill.start", {
		target,
		apply,
		resume,
		fromHeight,
		toHeight,
		limit,
	});

	const stats = await backfillFromFirehose({
		target,
		apply,
		fromHeight,
		toHeight,
		limit,
		maxBatches,
		resume,
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
