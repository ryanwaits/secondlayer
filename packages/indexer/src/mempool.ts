import { getDb } from "@secondlayer/shared/db";
import type {
	Database,
	InsertMempoolTransaction,
} from "@secondlayer/shared/db/schema";
import { logger } from "@secondlayer/shared/logger";
import {
	hexToBytes,
	txidFromBytes,
	without0x,
} from "@secondlayer/stacks/utils";
import type { Kysely } from "kysely";
import { decodeRawTx } from "./parser.ts";

/**
 * Mempool (pending tx) ingest. The Stacks node's `/new_mempool_tx` callback
 * POSTs a bare array of raw_tx hex strings — no txid — so we derive the txid by
 * hashing the serialized bytes (sha512/256), exactly how the node computes it.
 * Pending txs are pre-chain: no block_height/tx_index/result/events. Rows are
 * removed on confirmation (block ingest) or drop (`/drop_mempool_tx`); a
 * retention sweep clears stuck rows. Writes are idempotent on tx_id because the
 * HTTP receiver runs on every indexer instance.
 */

/** Derive the 0x-prefixed Stacks txid from a raw_tx hex string. */
export function txidFromRawTx(rawTx: string): string {
	return `0x${txidFromBytes(hexToBytes(without0x(rawTx)))}`;
}

/** Build a mempool row from a raw_tx hex string, or null if it can't be
 *  decoded (e.g. a malformed/unsupported tx — skipped rather than dropping the
 *  whole batch). */
export function buildMempoolRow(
	rawTx: string,
): InsertMempoolTransaction | null {
	const decoded = decodeRawTx(rawTx);
	if (!decoded) return null;
	return {
		tx_id: txidFromRawTx(rawTx),
		raw_tx: rawTx,
		type: decoded.txType,
		sender: decoded.sender,
		contract_id: decoded.contractId,
		function_name: decoded.functionName,
		function_args: decoded.functionArgs,
	};
}

/** Persist a batch of mempool raw_tx hex strings (single multi-row upsert).
 *  Idempotent on tx_id. Returns the count of decodable rows written. */
export async function ingestMempoolTxs(
	db: Kysely<Database>,
	rawTxs: string[],
): Promise<number> {
	const rows = rawTxs
		.map(buildMempoolRow)
		.filter((row): row is InsertMempoolTransaction => row !== null);
	if (rows.length === 0) return 0;
	await db
		.insertInto("mempool_transactions")
		.values(rows)
		// biome-ignore lint/suspicious/noExplicitAny: kysely onConflict builder
		.onConflict((oc: any) => oc.column("tx_id").doNothing())
		.execute();
	return rows.length;
}

/** Remove txs from the mempool by tx_id. Used both for genuine drops
 *  (`/drop_mempool_tx`) and for eviction-on-confirmation from block ingest.
 *  DELETE-only (never inserts), so a late drop for an already-evicted tx is a
 *  harmless 0-row delete — no phantom resurrection. Accepts a transaction so
 *  eviction can run inside the block-persist tx. */
export async function removeMempoolTxs(
	db: Kysely<Database>,
	txIds: string[],
): Promise<void> {
	if (txIds.length === 0) return;
	await db
		.deleteFrom("mempool_transactions")
		.where("tx_id", "in", txIds)
		.execute();
}

/** Delete stuck mempool rows older than the retention window — txs the node
 *  garbage-collected without a drop event, or that simply never confirmed.
 *  Returns the number of rows deleted. */
export async function sweepStaleMempool(
	db: Kysely<Database>,
	olderThanHours: number,
): Promise<number> {
	const cutoff = new Date(Date.now() - olderThanHours * 3_600_000);
	const result = await db
		.deleteFrom("mempool_transactions")
		.where("received_at", "<", cutoff)
		.executeTakeFirst();
	return Number(result.numDeletedRows ?? 0);
}

const MEMPOOL_RETENTION_HOURS = Number(
	process.env.MEMPOOL_RETENTION_HOURS ?? "24",
);
const MEMPOOL_SWEEP_INTERVAL_MS = Number(
	process.env.MEMPOOL_SWEEP_INTERVAL_MS ?? String(15 * 60_000),
);

/** Leader-gated periodic retention sweep (singleton — see startLeaderLoops). */
export function startMempoolSweep(): () => void {
	const interval = setInterval(async () => {
		try {
			const deleted = await sweepStaleMempool(getDb(), MEMPOOL_RETENTION_HOURS);
			if (deleted > 0) logger.debug("mempool retention sweep", { deleted });
		} catch (error) {
			logger.warn("mempool retention sweep failed", { error: String(error) });
		}
	}, MEMPOOL_SWEEP_INTERVAL_MS);
	return () => clearInterval(interval);
}
