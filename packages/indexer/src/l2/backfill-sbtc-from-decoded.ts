/**
 * One-time backfill of sBTC decoded rows from the full-genesis `decoded_events`
 * table — NOT from Streams.
 *
 * Why: the live sBTC L2 decoders (l2.sbtc.v1 / l2.sbtc_token.v1) consume the
 * Streams firehose, whose replayable history is retention-/dump-bounded (~block
 * 7.9M). `decoded_events` already holds every sBTC event from genesis (~block
 * 329k), so we reconstruct the gap by feeding those rows through the SAME decode
 * functions the live path uses. Idempotent (upsert on cursor) and safe to re-run;
 * it does NOT touch the live decoder checkpoints — the live consumer keeps owning
 * the tip and writes the same rows identically where ranges overlap.
 *
 * Usage:
 *   bun run packages/indexer/src/l2/backfill-sbtc-from-decoded.ts \
 *     --target events            # events | token | both  (default: events)
 *     [--from-height N] [--to-height N] [--batch 2000] [--apply]
 *
 * Default is a DRY RUN (decode + count + sample, no writes). Pass --apply to write.
 */

import type { StreamsEvent } from "@secondlayer/sdk";
import { getSourceDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import { logger } from "@secondlayer/shared/logger";
import {
	SBTC_ASSET_IDENTIFIER_MAINNET,
	SBTC_CONTRACTS,
} from "@secondlayer/stacks/sbtc";
import type { Kysely } from "kysely";
import { decodeRegistryPrint, decodeTokenEvent } from "./decoders/sbtc.ts";
import {
	SBTC_DECODER_NAME,
	SBTC_TOKEN_DECODER_NAME,
	type SbtcEventRow,
	type SbtcTokenEventRow,
	writeSbtcEvents,
	writeSbtcTokenEvents,
} from "./sbtc-storage.ts";

const REGISTRY_CONTRACTS = [
	`${SBTC_CONTRACTS.mainnet.address}.${SBTC_CONTRACTS.mainnet.registry}`,
	`${SBTC_CONTRACTS.testnet.address}.${SBTC_CONTRACTS.testnet.registry}`,
];
const TOKEN_ASSET_IDS = [
	SBTC_ASSET_IDENTIFIER_MAINNET,
	`${SBTC_CONTRACTS.testnet.address}.${SBTC_CONTRACTS.testnet.token}::sbtc-token`,
];
const FT_TYPES = ["ft_mint", "ft_burn", "ft_transfer"];

type Target = "events" | "token" | "both";

export type DecodedRow = {
	cursor: string;
	block_height: string | number;
	tx_id: string;
	tx_index: number;
	event_index: number;
	event_type: string;
	contract_id: string | null;
	asset_identifier: string | null;
	sender: string | null;
	recipient: string | null;
	amount: string | null;
	memo: string | null;
	// jsonb may arrive parsed (object) or raw (string) depending on the driver path.
	payload: Record<string, unknown> | string | null;
	block_ts: string | number; // unix seconds from blocks.timestamp
};

/** decoded_events.payload can come back as a JSON string over the raw-sql path. */
function asPayloadObject(
	payload: Record<string, unknown> | string | null,
): Record<string, unknown> {
	if (payload && typeof payload === "object") return payload;
	if (typeof payload === "string") {
		try {
			const parsed = JSON.parse(payload);
			return parsed && typeof parsed === "object" ? parsed : {};
		} catch {
			return {};
		}
	}
	return {};
}

/** Reconstruct the StreamsEvent the decoders expect from a decoded_events row. */
export function toStreamsEvent(row: DecodedRow): StreamsEvent {
	const isFt = FT_TYPES.includes(row.event_type);
	// print rows carry the Clarity tuple (incl. raw_value) in the jsonb payload;
	// ft rows carry their fields in flat columns, so rebuild the payload shape
	// decodeTokenEvent reads (amount/sender/recipient/memo/asset_identifier).
	const payload: Record<string, unknown> = isFt
		? {
				asset_identifier: row.asset_identifier,
				amount: row.amount,
				sender: row.sender,
				recipient: row.recipient,
				memo: row.memo,
			}
		: asPayloadObject(row.payload);
	return {
		cursor: row.cursor,
		block_height: Number(row.block_height),
		block_hash: "",
		burn_block_height: 0,
		tx_id: row.tx_id,
		tx_index: row.tx_index,
		event_index: row.event_index,
		event_type: row.event_type as StreamsEvent["event_type"],
		contract_id: row.contract_id,
		payload,
		ts: new Date(Number(row.block_ts) * 1000).toISOString(),
		canonical: true,
	} as StreamsEvent;
}

async function fetchBatch(
	db: Kysely<Database>,
	target: Target,
	after: { bh: number; ei: number },
	fromHeight: number,
	toHeight: number,
	limit: number,
): Promise<DecodedRow[]> {
	const wantPrint = target === "events" || target === "both";
	const wantFt = target === "token" || target === "both";
	// Keyset over (block_height, event_index) — the cursor string sorts wrong
	// lexically, so paginate on the numeric tuple.
	const { rows } = await sql<DecodedRow>`
		SELECT de.cursor, de.block_height, de.tx_id, de.tx_index, de.event_index,
		       de.event_type, de.contract_id, de.asset_identifier, de.sender,
		       de.recipient, de.amount, de.memo, de.payload,
		       b.timestamp AS block_ts
		FROM decoded_events de
		JOIN blocks b ON b.height = de.block_height AND b.canonical = true
		WHERE de.canonical = true
		  AND de.block_height >= ${fromHeight}
		  AND de.block_height <= ${toHeight}
		  AND (
		    (${wantPrint} AND de.event_type = 'print' AND de.contract_id = ANY(${REGISTRY_CONTRACTS}))
		    OR
		    (${wantFt} AND de.event_type = ANY(${FT_TYPES}) AND de.asset_identifier = ANY(${TOKEN_ASSET_IDS}))
		  )
		  AND (de.block_height, de.event_index) > (${after.bh}, ${after.ei})
		ORDER BY de.block_height, de.event_index
		LIMIT ${limit}
	`.execute(db);
	return rows;
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
	const toHeight = Number(flag("--to-height") ?? Number.MAX_SAFE_INTEGER);
	const batch = Number(flag("--batch") ?? 2000);
	const maxBatches = Number(flag("--max-batches") ?? Number.MAX_SAFE_INTEGER);

	if (!["events", "token", "both"].includes(target)) {
		throw new Error(`--target must be events|token|both, got ${target}`);
	}

	const db = getSourceDb();
	logger.info("sbtc_backfill.start", {
		target,
		apply,
		fromHeight,
		toHeight,
		batch,
	});

	// Start the keyset just below fromHeight so the first row at fromHeight is
	// included (event_index seed = int4 max, above any real event_index).
	let after = { bh: fromHeight - 1, ei: 2_147_483_647 };
	let scanned = 0;
	let eventsWritten = 0;
	let tokenWritten = 0;
	let batches = 0;
	const sampleTopics = new Map<string, number>();

	for (;;) {
		if (batches >= maxBatches) break;
		const rows = await fetchBatch(
			db,
			target,
			after,
			fromHeight,
			toHeight,
			batch,
		);
		if (rows.length === 0) break;
		batches += 1;
		scanned += rows.length;

		const eventRows: SbtcEventRow[] = [];
		const tokenRows: SbtcTokenEventRow[] = [];
		for (const row of rows) {
			const event = toStreamsEvent(row);
			if (row.event_type === "print") {
				const decoded = decodeRegistryPrint(event);
				if (decoded) {
					eventRows.push(decoded);
					sampleTopics.set(
						decoded.topic,
						(sampleTopics.get(decoded.topic) ?? 0) + 1,
					);
				}
			} else {
				const decoded = decodeTokenEvent(event);
				if (decoded) tokenRows.push(decoded);
			}
		}

		if (apply) {
			if (eventRows.length) await writeSbtcEvents(eventRows, { db });
			if (tokenRows.length) await writeSbtcTokenEvents(tokenRows, { db });
		}
		eventsWritten += eventRows.length;
		tokenWritten += tokenRows.length;

		const last = rows[rows.length - 1];
		after = { bh: Number(last.block_height), ei: last.event_index };

		if (batches % 10 === 0) {
			logger.info("sbtc_backfill.progress", {
				batches,
				scanned,
				eventsWritten,
				tokenWritten,
				atHeight: after.bh,
			});
		}
	}

	logger.info("sbtc_backfill.done", {
		target,
		apply,
		scanned,
		eventsWritten,
		tokenWritten,
		topics: Object.fromEntries(sampleTopics),
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
