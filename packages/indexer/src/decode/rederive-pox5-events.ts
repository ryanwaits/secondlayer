/**
 * Bounded, one-time re-derivation of `pox5_events` for a block-height window —
 * the same pattern as `rederive-decoded-events.ts`, scoped to the single
 * pox-5 decoder: delete the window, then re-decode it from the now-clean
 * `events` firehose with the exact live decode function.
 *
 * Run this AFTER a source repair (e.g. `repair-from-journal.ts`), never
 * before: if the window's `pox5_events` rows are currently ahead of a
 * short-block `events` table (rows the source is temporarily missing), a
 * re-derive run first would wipe them before the repair puts the source back.
 *
 * Dry-run by default; `--apply` deletes and rewrites each chunk of N heights
 * (`--chunk-blocks`, default 10,000) in one transaction, so a crash leaves every
 * chunk fully old or fully new. Rerunning a range already done deletes and
 * rewrites it; for an incremental top-up, pass `--from-height` = the previous
 * run's `--to-height` + 1. Keeps NO checkpoint of its own and never touches the live
 * `decode.pox5.v1` checkpoint, so the live decoder stays at tip.
 *
 * Usage:
 *   bun run packages/indexer/src/decode/rederive-pox5-events.ts --from-height 8831514 --to-height 8831514
 *   bun run packages/indexer/src/decode/rederive-pox5-events.ts --from-height 8831514 --to-height 8831514 --apply
 *   ... --chunk-blocks 5000   # heights per transaction
 */
import { decodeStreamsCursor } from "@secondlayer/shared";
import { closeDb, getSourceDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import { logger } from "@secondlayer/shared/logger";
import type { StreamsEvent } from "@secondlayer/shared/streams-rows";
import { POX5_CONTRACT_ID_MAINNET } from "@secondlayer/stacks/pox5";
import type { Kysely } from "kysely";
import { readCanonicalStreamsEvents } from "../streams-events.ts";
import { decodePox5Print } from "./decoders/pox-5.ts";
import { type Pox5EventRow, writePox5Events } from "./pox5-storage.ts";

const PAGE_LIMIT = 1000;
const DEFAULT_CHUNK_BLOCKS = 10_000;

type Args = {
	fromHeight: number;
	toHeight: number;
	apply: boolean;
	chunkBlocks?: number;
};

export function parseArgs(argv: string[]): Args {
	let fromHeight: number | undefined;
	let toHeight: number | undefined;
	let apply = false;
	let chunkBlocks: number | undefined;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--apply") apply = true;
		else if (arg === "--from-height") fromHeight = Number(argv[++i]);
		else if (arg === "--to-height") toHeight = Number(argv[++i]);
		else if (arg === "--chunk-blocks") {
			chunkBlocks = Number(argv[++i]);
			if (!Number.isSafeInteger(chunkBlocks) || chunkBlocks <= 0) {
				throw new Error("--chunk-blocks must be a positive integer");
			}
		} else throw new Error(`unknown flag: ${arg}`);
	}
	if (
		fromHeight === undefined ||
		toHeight === undefined ||
		!Number.isSafeInteger(fromHeight) ||
		!Number.isSafeInteger(toHeight) ||
		fromHeight > toHeight
	) {
		throw new Error("--from-height and --to-height (from <= to) are required");
	}
	return { fromHeight, toHeight, apply, chunkBlocks };
}

type Chunk = { fromHeight: number; toHeight: number };

export type RederiveOptions = {
	db?: Kysely<Database>;
	chunkBlocks?: number;
	beforeChunkCommit?: (chunk: Chunk) => Promise<void> | void;
};

async function rederiveChunk(
	handle: Kysely<Database>,
	chunk: Chunk,
	apply: boolean,
): Promise<{ deleted: number; read: number; decoded: number }> {
	let deleted = 0;
	if (apply) {
		const res = await sql`
			DELETE FROM pox5_events
			WHERE block_height >= ${chunk.fromHeight} AND block_height <= ${chunk.toHeight}
		`.execute(handle);
		deleted = Number(res.numAffectedRows ?? 0n);
	}

	let after: { block_height: number; event_index: number } | undefined;
	let read = 0;
	let decoded = 0;
	for (;;) {
		const page = await readCanonicalStreamsEvents({
			after,
			fromHeight: after ? undefined : chunk.fromHeight,
			toHeight: chunk.toHeight,
			types: ["print"],
			contractId: POX5_CONTRACT_ID_MAINNET,
			limit: PAGE_LIMIT,
			db: handle,
		});
		read += page.events.length;

		const rows: Pox5EventRow[] = [];
		for (const event of page.events as StreamsEvent[]) {
			try {
				const row = decodePox5Print(event);
				if (row) rows.push(row);
			} catch (error) {
				logger.warn("rederive_pox5.decode_skipped", {
					cursor: event.cursor,
					tx_id: event.tx_id,
					error: String(error),
				});
			}
		}
		decoded += rows.length;
		if (apply && rows.length > 0) await writePox5Events(rows, { db: handle });

		if (!page.next_cursor) break;
		const next = decodeStreamsCursor(page.next_cursor);
		if (page.events.length === 0 && next.block_height >= chunk.toHeight) break;
		after = next;
	}

	return { deleted, read, decoded };
}

export async function rederivePox5Events(
	args: Args,
	opts?: RederiveOptions,
): Promise<{
	deleted: number;
	read: number;
	decoded: number;
}> {
	const db = opts?.db ?? getSourceDb();
	const chunkBlocks =
		opts?.chunkBlocks ?? args.chunkBlocks ?? DEFAULT_CHUNK_BLOCKS;
	const total = { deleted: 0, read: 0, decoded: 0 };
	for (let from = args.fromHeight; from <= args.toHeight; from += chunkBlocks) {
		const chunk = {
			fromHeight: from,
			toHeight: Math.min(from + chunkBlocks - 1, args.toHeight),
		};
		const result = args.apply
			? await db.transaction().execute(async (trx) => {
					const res = await rederiveChunk(trx, chunk, true);
					await opts?.beforeChunkCommit?.(chunk);
					return res;
				})
			: await rederiveChunk(db, chunk, false);
		total.deleted += result.deleted;
		total.read += result.read;
		total.decoded += result.decoded;
	}
	return total;
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	console.log(
		`[rederive-pox5-events] range [${args.fromHeight}, ${args.toHeight}] · ${args.apply ? "APPLY" : "dry-run"}`,
	);
	const result = await rederivePox5Events(args);
	console.log(
		`[rederive-pox5-events] deleted ${result.deleted} · read ${result.read} · decoded ${result.decoded}${args.apply ? " (written)" : " (dry-run, nothing written)"}`,
	);
	await closeDb();
}

if (import.meta.main) {
	main().catch(async (error) => {
		console.error(error instanceof Error ? error.message : error);
		await closeDb().catch(() => {});
		process.exit(1);
	});
}
