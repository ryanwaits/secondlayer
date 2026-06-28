import { getSourceDb } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import { type Kysely, sql } from "kysely";
import {
	type TxConfirmation,
	bitcoinConfirmationReader,
} from "./bitcoin-rpc.ts";
import type { DecoderHealth } from "./health.ts";
import { writeDecoderCheckpoint } from "./storage.ts";

/**
 * BTC L1 settlement confirmer for sBTC withdrawals.
 *
 * A work-queue poller (NOT a per-block decoder): it reads `withdrawal-accept`
 * sweep txids that aren't yet confirmed on Bitcoin, asks our own bitcoind for
 * their confirmation count, and records it in `sbtc_settlements`. The API's
 * withdrawal lifecycle then reports real `btc_confirmations` / `settlement_confirmed`.
 *
 * Deliberately kept OUT of `getEnabledDecoderNames()` (storage.ts): that list is
 * the default decoder set for both the health endpoint AND `floor-audit.ts`, and
 * this worker has no genesis floor to baseline. It gets a dedicated health path
 * (`getSettlementConfirmerHealth`) wired directly into service.ts instead.
 */

export const SETTLEMENT_CONFIRMER_NAME = "settle.sbtc.v1";

/** Confirmations required before a sweep counts as settled (founder-locked default 6). */
export const SETTLEMENT_CONFIRMATIONS = Number.parseInt(
	process.env.SBTC_SETTLEMENT_CONFIRMATIONS ?? "6",
	10,
);

/**
 * Keep re-checking an already-CONFIRMED sweep until it is this many confirmations
 * deep, so a post-confirmation Bitcoin reorg that drops it below the threshold
 * un-confirms it. Beyond this depth a reorg is effectively impossible, so the row
 * leaves the work queue permanently (bounds the watch set). Must exceed
 * SETTLEMENT_CONFIRMATIONS to have any effect.
 */
export const SETTLEMENT_REORG_WATCH_DEPTH = Number.parseInt(
	process.env.SBTC_SETTLEMENT_REORG_WATCH_DEPTH ??
		String(SETTLEMENT_CONFIRMATIONS + 6),
	10,
);

const FIVE_MINUTES_MS = 5 * 60_000;

type SweepReader = { getConfirmations(txid: string): Promise<TxConfirmation> };

interface PendingSweep {
	sweep_txid: string;
	request_id: number;
}

function db(handle?: Kysely<Database>): Kysely<Database> {
	return handle ?? getSourceDb();
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) return;
	await new Promise<void>((resolve) => {
		const timeout = setTimeout(resolve, ms);
		signal?.addEventListener(
			"abort",
			() => {
				clearTimeout(timeout);
				resolve();
			},
			{ once: true },
		);
	});
}

function readerFromEnv(): SweepReader {
	const url = process.env.BITCOIN_RPC_URL;
	if (!url) {
		throw new Error(
			"BITCOIN_RPC_URL is required for the sBTC settlement confirmer",
		);
	}
	const auth =
		process.env.BITCOIN_RPC_AUTH ??
		(process.env.BITCOIN_RPC_USERNAME && process.env.BITCOIN_RPC_PASSWORD
			? {
					username: process.env.BITCOIN_RPC_USERNAME,
					password: process.env.BITCOIN_RPC_PASSWORD,
				}
			: undefined);
	return bitcoinConfirmationReader({ url, auth });
}

/**
 * Pending sweeps to (re)check: canonical `withdrawal-accept` rows with a
 * `sweep_txid` that either (a) have no settlement row yet, (b) aren't confirmed,
 * or (c) are confirmed but still within the reorg-watch window — case (c) keeps
 * a confirmed sweep under observation so a post-confirmation Bitcoin reorg can
 * un-confirm it, until it buries past SETTLEMENT_REORG_WATCH_DEPTH and drops out.
 * Ordered least-recently-checked first (never-checked sort first) for a fair
 * drain. `DISTINCT ON (sweep_txid)` collapses any duplicate accepts sharing a
 * sweep — belt-and-suspenders, since `sweep_txid` is the settlements PK.
 */
export async function readPendingSweeps(opts: {
	db?: Kysely<Database>;
	limit: number;
}): Promise<PendingSweep[]> {
	const rows = await db(opts.db)
		.selectFrom("sbtc_events as e")
		.leftJoin("sbtc_settlements as s", "s.sweep_txid", "e.sweep_txid")
		.where("e.canonical", "=", true)
		.where("e.topic", "=", "withdrawal-accept")
		.where("e.sweep_txid", "is not", null)
		.where("e.request_id", "is not", null)
		.where((eb) =>
			eb.or([
				eb("s.sweep_txid", "is", null),
				eb("s.settlement_confirmed", "=", false),
				eb.and([
					eb("s.settlement_confirmed", "=", true),
					eb("s.btc_confirmations", "<", SETTLEMENT_REORG_WATCH_DEPTH),
				]),
			]),
		)
		.select(["e.sweep_txid", "e.request_id"])
		.distinctOn("e.sweep_txid")
		.orderBy("e.sweep_txid")
		.orderBy(sql`s.last_checked_at asc nulls first`)
		.limit(opts.limit)
		.execute();

	// The WHERE clauses guarantee non-null. request_id is a BIGINT (returned as a
	// string by pg) — coerce to match the declared `number` contract.
	return rows.map((r) => ({
		sweep_txid: r.sweep_txid as string,
		request_id: Number(r.request_id),
	}));
}

async function upsertSettlement(
	handle: Kysely<Database>,
	sweep: PendingSweep,
	conf: TxConfirmation,
	confirmed: boolean,
): Promise<void> {
	const now = new Date();
	await handle
		.insertInto("sbtc_settlements")
		.values({
			sweep_txid: sweep.sweep_txid,
			request_id: sweep.request_id,
			btc_confirmations: conf.confirmations,
			settlement_confirmed: confirmed,
			block_hash: conf.blockHash,
			block_height: conf.blockHeight,
			// Stamp confirmed_at on insert too — a sweep already past threshold the
			// first time we see it is confirmed on INSERT, where the onConflict CASE
			// below never runs.
			confirmed_at: confirmed ? now : null,
		})
		.onConflict((oc) =>
			oc.column("sweep_txid").doUpdateSet((eb) => ({
				btc_confirmations: eb.ref("excluded.btc_confirmations"),
				settlement_confirmed: eb.ref("excluded.settlement_confirmed"),
				block_hash: eb.ref("excluded.block_hash"),
				block_height: eb.ref("excluded.block_height"),
				last_checked_at: now,
				updated_at: now,
				// While confirmed: preserve the original confirm timestamp (COALESCE).
				// On un-confirm (a Bitcoin reorg dropped it below threshold): clear it,
				// so confirmed_at always agrees with settlement_confirmed.
				confirmed_at: sql`CASE WHEN excluded.settlement_confirmed THEN COALESCE(sbtc_settlements.confirmed_at, now()) ELSE NULL END`,
			})),
		)
		.execute();
}

/**
 * Drop settlement rows whose backing `withdrawal-accept` no longer exists as a
 * canonical sweep — orphans left when a Stacks reorg hard-DELETEs accept rows
 * from `sbtc_events` (handleSbtcReorg). Called inside that same leader-gated
 * reorg transaction. If the withdrawal re-decodes on the new fork with the same
 * `sweep_txid` (the common case — the sweep is a Bitcoin fact), the row survives
 * and keeps its confirmation history; only a genuinely-vanished sweep is removed.
 */
export async function deleteOrphanedSettlements(opts?: {
	db?: Kysely<Database>;
}): Promise<number> {
	const result = await db(opts?.db)
		.deleteFrom("sbtc_settlements")
		.where("sweep_txid", "not in", (qb) =>
			qb
				.selectFrom("sbtc_events")
				.select("sweep_txid")
				.where("topic", "=", "withdrawal-accept")
				.where("canonical", "=", true)
				.where("sweep_txid", "is not", null),
		)
		.executeTakeFirst();
	return Number(result.numDeletedRows ?? 0);
}

/**
 * One confirmer tick, shaped like the decode-service `consume` contract so it
 * runs under `runDecoder` (abort loop, error backoff, per-iteration liveness).
 * A `seen` set guarantees each sweep is processed at most once per call, so the
 * loop terminates once the queue is drained even when it's smaller than a page.
 */
export async function consumeSbtcSettlements(opts: {
	batchSize?: number;
	emptyBackoffMs?: number;
	maxEmptyPolls?: number;
	signal?: AbortSignal;
	onProgress?: (stats: {
		decoded: number;
		cursor?: string | null;
		lagSeconds?: number;
	}) => void | Promise<void>;
	db?: Kysely<Database>;
	reader?: SweepReader;
}): Promise<{ cursor: string | null; pages: number; decoded: number }> {
	const handle = db(opts.db);
	const reader = opts.reader ?? readerFromEnv();
	const batchSize = opts.batchSize ?? 500;
	const emptyBackoffMs = opts.emptyBackoffMs ?? 1000;
	const maxEmptyPolls = opts.maxEmptyPolls ?? 1;

	// Seed the checkpoint row so health can read `updated_at` — bumpDecoderCheckpoint
	// (runDecoder's liveness ping) is UPDATE-only and no-ops if the row is absent.
	await writeDecoderCheckpoint({
		db: opts.db,
		cursor: null,
		decoderName: SETTLEMENT_CONFIRMER_NAME,
	});

	const seen = new Set<string>();
	let pages = 0;
	let decoded = 0;
	let emptyPolls = 0;

	while (!opts.signal?.aborted) {
		const pending = await readPendingSweeps({ db: opts.db, limit: batchSize });
		pages += 1;
		const fresh = pending.filter((p) => !seen.has(p.sweep_txid));
		if (fresh.length === 0) {
			emptyPolls += 1;
			if (emptyPolls >= maxEmptyPolls) break;
			await sleep(emptyBackoffMs, opts.signal);
			continue;
		}
		emptyPolls = 0;
		for (const sweep of fresh) {
			if (opts.signal?.aborted) break;
			seen.add(sweep.sweep_txid);
			const conf = await reader.getConfirmations(sweep.sweep_txid);
			const confirmed = conf.confirmations >= SETTLEMENT_CONFIRMATIONS;
			await upsertSettlement(handle, sweep, conf, confirmed);
			decoded += 1;
			await opts.onProgress?.({ decoded: 1 });
		}
	}

	return { cursor: null, pages, decoded };
}

/**
 * Health for the confirmer, shaped like `DecoderHealth` so it slots into the
 * `/health` decoders array. Mirrors getDecoderHealth's necessary-but-not-sufficient
 * logic: the checkpoint heartbeat must be fresh (process alive) AND there must be a
 * real-work signal — either the queue is drained (backlog 0) or we wrote recently.
 */
export async function getSettlementConfirmerHealth(opts?: {
	db?: Kysely<Database>;
	now?: Date;
}): Promise<DecoderHealth> {
	const handle = db(opts?.db);
	const now = opts?.now ?? new Date();

	const checkpoint = await handle
		.selectFrom("decoder_checkpoints")
		.select(["last_cursor", "updated_at"])
		.where("decoder_name", "=", SETTLEMENT_CONFIRMER_NAME)
		.executeTakeFirst();

	const backlog = await handle
		.selectFrom("sbtc_events as e")
		.leftJoin("sbtc_settlements as s", "s.sweep_txid", "e.sweep_txid")
		.where("e.canonical", "=", true)
		.where("e.topic", "=", "withdrawal-accept")
		.where("e.sweep_txid", "is not", null)
		.where((eb) =>
			eb.or([
				eb("s.sweep_txid", "is", null),
				eb("s.settlement_confirmed", "=", false),
			]),
		)
		.select(sql<number>`count(distinct e.sweep_txid)`.as("backlog"))
		.executeTakeFirst();

	const lastWrite = await handle
		.selectFrom("sbtc_settlements")
		.select(sql<Date | null>`max(updated_at)`.as("updated_at"))
		.executeTakeFirst();

	const backlogCount = Number(backlog?.backlog ?? 0);
	const lastWriteAt = lastWrite?.updated_at ?? null;
	const writesRecent = lastWriteAt
		? now.getTime() - new Date(lastWriteAt).getTime() <= FIVE_MINUTES_MS
		: false;
	const checkpointRecent = checkpoint?.updated_at
		? now.getTime() - checkpoint.updated_at.getTime() <= FIVE_MINUTES_MS
		: false;

	return {
		status:
			checkpointRecent && (backlogCount === 0 || writesRecent)
				? "healthy"
				: "unhealthy",
		decoder: SETTLEMENT_CONFIRMER_NAME,
		checkpoint: checkpoint?.last_cursor ?? null,
		checkpoint_block_height: null,
		tip_block_height: null,
		lag_seconds: null,
		last_decoded_at: lastWriteAt ? new Date(lastWriteAt).toISOString() : null,
		writes_recent: writesRecent,
		checkpoint_recent: checkpointRecent,
	};
}
