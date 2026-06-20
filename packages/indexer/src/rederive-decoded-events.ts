/**
 * One-time, bounded re-derivation of `decoded_events` for a block range.
 *
 * After the 2026-06 `events` dedupe (removing whole-block physical duplicates +
 * adding events_logical_id_uniq), the dense `stream_event_index` recomputed by
 * `readCanonicalStreamsEvents` SHIFTED for every block that had a duplicate — so
 * the historical `decoded_events` rows in those ranges carry stale cursors and a
 * 2× inflation that re-decoding alone won't overwrite (the phantom cursors are
 * never regenerated). This deletes `decoded_events` in the range and re-derives
 * it from the now-clean firehose, reusing the EXACT live decode functions.
 *
 * Isolated by design: it pages `readCanonicalStreamsEvents` over a bounded
 * [from,to] height window and writes via the same idempotent `writeDecodedEvents`
 * (upsert on cursor) the live decoders use — but it keeps NO checkpoint and never
 * touches the live decoder_checkpoints, so the live decoder stays at tip with
 * zero lag. Dry-run by default; `--apply` deletes + writes. Idempotent.
 *
 * `--types` is REQUIRED and must match exactly the types decoded_events already
 * holds in the range (GROUP BY event_type first) — see parseArgs. Affected ranges
 * from the 2026-06 dedupe (run once per cluster):
 *   # BIG range holds only ft_*:
 *   bun run packages/indexer/src/rederive-decoded-events.ts --from-height 2000000 --to-height 4327077 --types ft_transfer,ft_mint,ft_burn          # dry-run
 *   bun run packages/indexer/src/rederive-decoded-events.ts --from-height 2000000 --to-height 4327077 --types ft_transfer,ft_mint,ft_burn --apply
 *   # 7M cluster holds 9 types (no print, no nft_transfer):
 *   bun run packages/indexer/src/rederive-decoded-events.ts --from-height 7440000 --to-height 7610000 --types stx_transfer,stx_mint,stx_burn,stx_lock,ft_transfer,ft_mint,ft_burn,nft_mint,nft_burn --apply
 *
 * Run against the SOURCE/chain plane (getSourceDb), AFTER events is deduped and
 * events_logical_id_uniq is VALID. See
 * `docs/internal/audits/decoded-events-supply-shortfall-2026-06-15.md`.
 */
import {
	type DecodedEventRow,
	type StreamsEvent,
	type StreamsEventType,
	decodeFtBurn,
	decodeFtMint,
	decodeFtTransfer,
	decodeNftBurn,
	decodeNftMint,
	decodeNftTransfer,
	decodePrint,
	decodeStxBurn,
	decodeStxLock,
	decodeStxMint,
	decodeStxTransfer,
} from "@secondlayer/sdk";
import { decodeStreamsCursor } from "@secondlayer/shared";
import { closeDb, getSourceDb, sql } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import { writeDecodedEvents } from "./decode/storage.ts";
import { readCanonicalStreamsEvents } from "./streams-events.ts";

// event_type → the live decode fn. Covers every type `decoded_events` stores.
const DECODERS: Record<string, (event: StreamsEvent) => DecodedEventRow> = {
	stx_transfer: decodeStxTransfer,
	stx_mint: decodeStxMint,
	stx_burn: decodeStxBurn,
	stx_lock: decodeStxLock,
	ft_transfer: decodeFtTransfer,
	ft_mint: decodeFtMint,
	ft_burn: decodeFtBurn,
	nft_transfer: decodeNftTransfer,
	nft_mint: decodeNftMint,
	nft_burn: decodeNftBurn,
	print: decodePrint,
};
const ALL_TYPES = Object.keys(DECODERS) as StreamsEventType[];

const PAGE_LIMIT = 1000;
const DELETE_BATCH_BLOCKS = 50_000;

type Args = {
	fromHeight: number;
	toHeight: number;
	apply: boolean;
	types: StreamsEventType[];
};

function parseArgs(argv: string[]): Args {
	let fromHeight: number | undefined;
	let toHeight: number | undefined;
	let apply = false;
	// REQUIRED: decoded_events stores a different set of event types per historical
	// range (decoders were enabled at different heights). Re-deriving a type that
	// was never there would inject phantom rows; missing one leaves it inflated. So
	// the caller must pass exactly the types decoded_events already holds in the
	// range (verify with a GROUP BY event_type first). Both the DELETE and the
	// re-derive are scoped to this set; all other types are left untouched.
	let types: StreamsEventType[] = [];
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--apply") apply = true;
		else if (arg === "--from-height") fromHeight = Number(argv[++i]);
		else if (arg === "--to-height") toHeight = Number(argv[++i]);
		else if (arg === "--types") {
			types = (argv[++i] ?? "")
				.split(",")
				.map((t) => t.trim()) as StreamsEventType[];
		}
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
	if (types.length === 0 || types.some((t) => !DECODERS[t])) {
		throw new Error(
			`--types is required, comma-separated, each one of: ${ALL_TYPES.join(",")}`,
		);
	}
	return { fromHeight, toHeight, apply, types };
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const db = getSourceDb();
	console.log(
		`[rederive-decoded-events] range [${args.fromHeight}, ${args.toHeight}] · types [${args.types.join(",")}] · ${args.apply ? "APPLY" : "dry-run"}`,
	);

	const typeList = sql.join(
		args.types.map((t) => sql.lit(t)),
		sql`, `,
	);

	// Delete the stale rows first (their shifted/phantom cursors are never
	// regenerated, so re-decode alone would leave them behind). Scoped to --types
	// so other event types in the range are untouched. Batched so no single
	// statement locks the whole table.
	if (args.apply) {
		let deleted = 0;
		for (
			let lo = args.fromHeight;
			lo <= args.toHeight;
			lo += DELETE_BATCH_BLOCKS
		) {
			const hi = Math.min(lo + DELETE_BATCH_BLOCKS - 1, args.toHeight);
			const res = await sql`
				DELETE FROM decoded_events
				WHERE block_height >= ${lo} AND block_height <= ${hi}
				AND event_type IN (${typeList})
			`.execute(db);
			deleted += Number(res.numAffectedRows ?? 0n);
		}
		console.log(
			`[rederive-decoded-events] deleted ${deleted} stale decoded rows`,
		);
	}

	// Page the clean firehose over the bounded range, decode every type, write.
	let after: { block_height: number; event_index: number } | undefined;
	let read = 0;
	let decoded = 0;
	let skipped = 0;
	for (;;) {
		const page = await readCanonicalStreamsEvents({
			after,
			fromHeight: after ? undefined : args.fromHeight,
			toHeight: args.toHeight,
			types: args.types,
			limit: PAGE_LIMIT,
			db,
		});
		read += page.events.length;

		const rows: DecodedEventRow[] = [];
		for (const event of page.events as StreamsEvent[]) {
			const decode = DECODERS[event.event_type];
			if (!decode) continue;
			try {
				rows.push(decode(event));
			} catch (error) {
				skipped += 1;
				logger.warn("rederive.decode_skipped", {
					cursor: event.cursor,
					tx_id: event.tx_id,
					error: String(error),
				});
			}
		}
		decoded += rows.length;
		if (args.apply && rows.length > 0) await writeDecodedEvents(rows, { db });

		if (read % 50_000 < PAGE_LIMIT) {
			console.log(
				`  …read ${read} events, decoded ${decoded}, skipped ${skipped}`,
			);
		}

		if (!page.next_cursor) break;
		const next = decodeStreamsCursor(page.next_cursor);
		if (page.events.length === 0 && next.block_height >= args.toHeight) break;
		after = next;
	}

	console.log(
		`[rederive-decoded-events] DONE — read ${read}, decoded ${decoded}, skipped ${skipped}${args.apply ? " (written)" : " (dry-run, nothing written)"}`,
	);
	await closeDb();
}

void main();
