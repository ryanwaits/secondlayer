import { getSourceDb } from "@secondlayer/shared/db";
import type {
	Database,
	InsertMempoolTransaction,
} from "@secondlayer/shared/db/schema";
import { logger } from "@secondlayer/shared/logger";
import { decodeRawTx, rawTxNonce } from "@secondlayer/shared/node/tx-summary";
import {
	hexToBytes,
	txidFromBytes,
	without0x,
} from "@secondlayer/stacks/utils";
import type { Kysely } from "kysely";

/**
 * Mempool (pending tx) ingest. The Stacks node's `/new_mempool_tx` callback
 * POSTs a bare array of raw_tx hex strings — no txid — so we derive the txid by
 * hashing the serialized bytes (sha512/256), exactly how the node computes it.
 * Pending txs are pre-chain: no block_height/tx_index/result/events. Rows are
 * removed on confirmation (block ingest), when a confirmed tx from the same
 * sender spends their nonce (block ingest), or on drop (`/drop_mempool_tx`); a
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
 *  Idempotent on tx_id. A tx already confirmed in a canonical block is skipped:
 *  the node can announce it after the block that mined it was ingested, and
 *  nothing would evict it again (block ingest already ran). Returns the count
 *  of rows written. */
export async function ingestMempoolTxs(
	db: Kysely<Database>,
	rawTxs: string[],
): Promise<number> {
	const decoded = rawTxs
		.map(buildMempoolRow)
		.filter((row): row is InsertMempoolTransaction => row !== null);
	if (decoded.length === 0) return 0;
	const confirmed = new Set(
		(
			await db
				.selectFrom("transactions as t")
				.innerJoin("blocks as b", "b.height", "t.block_height")
				.select("t.tx_id")
				.where(
					"t.tx_id",
					"in",
					decoded.map((row) => row.tx_id),
				)
				.where("b.canonical", "=", true)
				.execute()
		).map((row) => row.tx_id),
	);
	const rows = decoded.filter((row) => !confirmed.has(row.tx_id));
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

/** Remove pending txs a confirmed tx has made unminable. Once a sender's
 *  nonce N confirms, every pending tx of theirs at nonce <= N (replaced or
 *  conflicting) can never confirm, and the node rarely drops it, so it would
 *  sit here until the retention sweep while `?sender=` callers read it as in
 *  flight. Keyed by the origin nonce (a sponsor's own nonce is not tracked).
 *  Runs inside the block-persist tx. Returns the count evicted. */
export async function evictSupersededMempoolTxs(
	db: Kysely<Database>,
	confirmed: ReadonlyArray<{ sender: string; raw_tx: string }>,
): Promise<number> {
	const spentNonce = new Map<string, bigint>();
	for (const tx of confirmed) {
		const nonce = rawTxNonce(tx.raw_tx);
		if (nonce === null) continue;
		const current = spentNonce.get(tx.sender);
		if (current === undefined || nonce > current) {
			spentNonce.set(tx.sender, nonce);
		}
	}
	if (spentNonce.size === 0) return 0;
	const pending = await db
		.selectFrom("mempool_transactions")
		.select(["tx_id", "sender", "raw_tx"])
		.where("sender", "in", [...spentNonce.keys()])
		.execute();
	const superseded = pending
		.filter((row) => {
			const nonce = rawTxNonce(row.raw_tx);
			const spent = spentNonce.get(row.sender);
			return nonce !== null && spent !== undefined && nonce <= spent;
		})
		.map((row) => row.tx_id);
	await removeMempoolTxs(db, superseded);
	return superseded.length;
}

/** The node's own memory-pressure GC reason. A `StaleGarbageCollect` drop means
 *  the node evicted the tx from ITS mempool to free memory — NOT that the tx is
 *  invalid or gone from the network (another miner may still mine it). Honoring
 *  it would mirror one node's aggressive GC and drain our mempool to near-empty,
 *  so we keep these and let eviction-on-confirmation + the retention sweep clean
 *  them up. Genuine drops (RBF, replace-across-fork, problematic, …) are honored. */
export const STALE_GC_DROP_REASON = "StaleGarbageCollect";

export function isGenuineDrop(reason: string): boolean {
	return reason !== STALE_GC_DROP_REASON;
}

/** Delete stuck mempool rows older than the retention window. This is a
 *  *backstop*, not the primary eviction path — confirmed txs leave via
 *  eviction-on-confirmation (persistBlock) and genuinely-dropped txs via
 *  `/drop_mempool_tx`. The sweep only catches what neither covers: txs the node
 *  garbage-collected without a (honored) drop, or that simply never confirmed.
 *  The window is set well past the node's own GC horizon so valid pending txs
 *  accumulate (the go-forward observer only captures each tx once, so too short
 *  a window caps the table near-empty). Returns the number of rows deleted. */
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

export const MEMPOOL_RETENTION_HOURS = 72;
const MEMPOOL_SWEEP_INTERVAL_MS = 15 * 60_000;

/** Current row count of the mempool table — the accumulation depth. */
export async function mempoolDepth(db: Kysely<Database>): Promise<number> {
	const result = await db
		.selectFrom("mempool_transactions")
		.select((eb) => eb.fn.countAll<string>().as("n"))
		.executeTakeFirst();
	return Number(result?.n ?? 0);
}

/** Leader-gated periodic retention sweep (singleton — see startLeaderLoops).
 *  Logs the post-sweep depth at info level so accumulation is observable in
 *  prod (the table should climb over uptime, not sit near-empty). */
export function startMempoolSweep(): () => void {
	const interval = setInterval(async () => {
		try {
			const db = getSourceDb();
			const deleted = await sweepStaleMempool(db, MEMPOOL_RETENTION_HOURS);
			const count = await mempoolDepth(db);
			logger.info("mempool depth", { count, deleted });
		} catch (error) {
			logger.warn("mempool retention sweep failed", { error: String(error) });
		}
	}, MEMPOOL_SWEEP_INTERVAL_MS);
	return () => clearInterval(interval);
}
