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
 * Dry-run by default; `--apply` deletes + writes, one transaction per window.
 * Keeps NO checkpoint of its own and never touches the live
 * `decode.pox5.v1` checkpoint, so the live decoder stays at tip.
 *
 * Usage:
 *   bun run packages/indexer/src/decode/rederive-pox5-events.ts --from-height 8831514 --to-height 8831514
 *   bun run packages/indexer/src/decode/rederive-pox5-events.ts --from-height 8831514 --to-height 8831514 --apply
 */
import { decodeStreamsCursor } from "@secondlayer/shared";
import { closeDb, getSourceDb, sql } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import type { StreamsEvent } from "@secondlayer/shared/streams-rows";
import { POX5_CONTRACT_ID_MAINNET } from "@secondlayer/stacks/pox5";
import { readCanonicalStreamsEvents } from "../streams-events.ts";
import { decodePox5Print } from "./decoders/pox-5.ts";
import { type Pox5EventRow, writePox5Events } from "./pox5-storage.ts";

const PAGE_LIMIT = 1000;

type Args = { fromHeight: number; toHeight: number; apply: boolean };

function parseArgs(argv: string[]): Args {
	let fromHeight: number | undefined;
	let toHeight: number | undefined;
	let apply = false;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--apply") apply = true;
		else if (arg === "--from-height") fromHeight = Number(argv[++i]);
		else if (arg === "--to-height") toHeight = Number(argv[++i]);
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
	return { fromHeight, toHeight, apply };
}

export async function rederivePox5Events(args: Args): Promise<{
	deleted: number;
	read: number;
	decoded: number;
}> {
	const db = getSourceDb();
	let deleted = 0;
	if (args.apply) {
		const res = await sql`
			DELETE FROM pox5_events
			WHERE block_height >= ${args.fromHeight} AND block_height <= ${args.toHeight}
		`.execute(db);
		deleted = Number(res.numAffectedRows ?? 0n);
	}

	let after: { block_height: number; event_index: number } | undefined;
	let read = 0;
	let decoded = 0;
	for (;;) {
		const page = await readCanonicalStreamsEvents({
			after,
			fromHeight: after ? undefined : args.fromHeight,
			toHeight: args.toHeight,
			types: ["print"],
			contractId: POX5_CONTRACT_ID_MAINNET,
			limit: PAGE_LIMIT,
			db,
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
		if (args.apply && rows.length > 0) await writePox5Events(rows, { db });

		if (!page.next_cursor) break;
		const next = decodeStreamsCursor(page.next_cursor);
		if (page.events.length === 0 && next.block_height >= args.toHeight) break;
		after = next;
	}

	return { deleted, read, decoded };
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
	void main();
}
