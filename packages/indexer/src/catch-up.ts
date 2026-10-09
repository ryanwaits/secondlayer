import { type Database, getSourceDb } from "@secondlayer/shared/db";
import { OBSERVER_APPLY_LOCK_KEY } from "@secondlayer/shared/leader";
import { logger } from "@secondlayer/shared/logger";
import { StacksNodeClient } from "@secondlayer/shared/node/client";
import { type Kysely, sql } from "kysely";
import { type IngestResult, ingestNewBlock } from "./ingest.ts";
import {
	type ObserverReceipt,
	appendObserverReceipt,
	markObserverFailed,
	markObserverProcessed,
	parseObserverBody,
} from "./observer-journal.ts";
import type { NewBlockPayload } from "./types/node-events.ts";

/**
 * Catch-up ingest: during a long sync the node never waits on our database.
 *
 * Every journaled `/new_block` is applied by one applier, strictly in journal
 * `sequence` order, through the same `ingestNewBlock` as always. The mode only
 * decides when the node gets its reply:
 *
 *   live      reply after the applier has applied this block (today's
 *             guarantee: the node moves on only once the block is indexed)
 *   catch-up  reply once the block is journaled; the applier runs behind
 *
 * Catch-up is derived, never configured: on while the node is more than
 * {@link LIVE_BURN_TIP_DISTANCE} burn blocks behind its burn tip or the
 * backlog is at least {@link LIVE_BACKLOG_MAX}. `INGEST_MODE=live` forces it
 * off. Past {@link CATCH_UP_BACKLOG_LIMIT} unapplied blocks the reply waits
 * for room, so the node slows to the indexer's pace instead of running ahead
 * of the disk.
 *
 * Crash safety: the journal row is the durable record. A row stays `received`
 * until its derived state committed and the row was marked. A crash between
 * the two leaves a `received` row whose block is already canonical; applying
 * it again returns `duplicate` and changes nothing.
 */

/** Unapplied blocks at which the reply waits for the applier. */
export const CATCH_UP_BACKLOG_LIMIT = 2_000;
/** Live mode needs the backlog under this… */
export const LIVE_BACKLOG_MAX = 10;
/** …and the block within this many burn blocks of the node's burn tip. */
export const LIVE_BURN_TIP_DISTANCE = 6;

const BATCH_SIZE = 32;
const IDLE_POLL_MS = 1_000;
const RETRY_MIN_MS = 500;
const RETRY_MAX_MS = 30_000;
const NODE_TIP_TTL_MS = 30_000;

export type IngestMode = "live" | "catch-up";

export function chooseIngestMode(input: {
	forcedLive: boolean;
	backlog: number;
	blockBurnHeight: number;
	nodeBurnTip: number | null;
}): IngestMode {
	if (input.forcedLive) return "live";
	if (input.backlog >= LIVE_BACKLOG_MAX) return "catch-up";
	// Unknown tip (node RPC unreachable) keeps today's behavior.
	if (
		input.nodeBurnTip !== null &&
		input.nodeBurnTip - input.blockBurnHeight > LIVE_BURN_TIP_DISTANCE
	) {
		return "catch-up";
	}
	return "live";
}

/**
 * The node's burn tip from `/v2/info`, cached. Never blocks a reply: a stale
 * value triggers a background refresh and the last known value is returned.
 */
export function cachedNodeBurnTip(
	fetchTip: () => Promise<number> = async () =>
		(await new StacksNodeClient().getInfo()).burn_block_height,
	ttlMs = NODE_TIP_TTL_MS,
): () => number | null {
	let value: number | null = null;
	let fetchedAt = 0;
	let inFlight = false;
	return () => {
		if (!inFlight && Date.now() - fetchedAt >= ttlMs) {
			inFlight = true;
			fetchTip()
				.then((tip) => {
					value = Number.isSafeInteger(tip) ? tip : null;
				})
				.catch(() => {
					value = null;
				})
				.finally(() => {
					fetchedAt = Date.now();
					inFlight = false;
				});
		}
		return value;
	};
}

type JournalRow = {
	sequence: string | number | bigint;
	raw_body: Buffer;
	received_at: Date;
};

type Waiter = {
	resolve: (result: IngestResult) => void;
	reject: (error: unknown) => void;
};

export interface JournalApplierState {
	backlog: number;
	oldestReceivedAgeSeconds: number | null;
	appliedTotal: number;
	lastAppliedHeight: number | null;
	lastAppliedSecondsAgo: number | null;
	lastError: string | null;
}

export class JournalApplier {
	private readonly db: Kysely<Database>;
	private readonly network: string;
	private readonly ingest: (payload: NewBlockPayload) => Promise<IngestResult>;
	readonly backlogLimit: number;

	backlog = 0;
	private oldestReceivedAt: Date | null = null;
	private appliedTotal = 0;
	private lastAppliedHeight: number | null = null;
	private lastAppliedAt = 0;
	private lastError: string | null = null;

	private floor = 0n;
	private handledThrough = 0n;
	private readonly waiters = new Map<string, Waiter>();
	private roomWaiters: Array<() => void> = [];
	private idleWaiters: Array<() => void> = [];
	private wake: (() => void) | null = null;
	private notified = false;
	private running: Promise<void> | null = null;
	private stopped = false;

	constructor(options: {
		network: string;
		db?: Kysely<Database>;
		ingest?: (payload: NewBlockPayload) => Promise<IngestResult>;
		backlogLimit?: number;
	}) {
		this.network = options.network;
		this.db = options.db ?? getSourceDb();
		this.ingest = options.ingest ?? ((payload) => ingestNewBlock(payload));
		this.backlogLimit = options.backlogLimit ?? CATCH_UP_BACKLOG_LIMIT;
	}

	get started(): boolean {
		return this.running !== null;
	}

	/**
	 * Start draining. Rows at or below `floorSequence` are never applied: a
	 * refused bootstrap spool leaves its rows for the operator, as before.
	 */
	start(floorSequence?: string | null): void {
		if (this.running) return;
		this.floor = floorSequence ? BigInt(floorSequence) : 0n;
		this.stopped = false;
		this.running = this.loop();
	}

	async stop(): Promise<void> {
		this.stopped = true;
		this.wake?.();
		await this.running;
		this.running = null;
		for (const [sequence, waiter] of this.waiters) {
			waiter.reject(new Error(`applier stopped before sequence ${sequence}`));
		}
		this.waiters.clear();
		for (const resolve of this.roomWaiters.splice(0)) resolve();
		for (const resolve of this.idleWaiters.splice(0)) resolve();
	}

	/** A row was journaled. */
	notify(): void {
		this.backlog++;
		this.poke();
	}

	private poke(): void {
		this.notified = true;
		this.wake?.();
	}

	/** Resolve once `sequence` is applied; reject if its apply failed. */
	waitApplied(sequence: string): Promise<IngestResult> {
		const promise = new Promise<IngestResult>((resolve, reject) => {
			this.waiters.set(sequence, { resolve, reject });
		});
		// The applier can get to the row before the caller registers.
		if (BigInt(sequence) <= this.handledThrough) {
			void this.settleFromJournal(sequence);
		}
		this.poke();
		return promise;
	}

	/** Resolve once the backlog is within the limit (backpressure). */
	waitForRoom(): Promise<void> {
		if (this.backlog <= this.backlogLimit) return Promise.resolve();
		return new Promise((resolve) => this.roomWaiters.push(resolve));
	}

	/** Resolve after a drain pass finds nothing left to apply. */
	whenIdle(): Promise<void> {
		return new Promise((resolve) => {
			this.idleWaiters.push(resolve);
			this.poke();
		});
	}

	state(): JournalApplierState {
		return {
			backlog: this.backlog,
			oldestReceivedAgeSeconds: this.oldestReceivedAt
				? Math.max(
						0,
						Math.round((Date.now() - this.oldestReceivedAt.getTime()) / 1000),
					)
				: null,
			appliedTotal: this.appliedTotal,
			lastAppliedHeight: this.lastAppliedHeight,
			lastAppliedSecondsAgo:
				this.lastAppliedAt > 0
					? Math.round((Date.now() - this.lastAppliedAt) / 1000)
					: null,
			lastError: this.lastError,
		};
	}

	private async loop(): Promise<void> {
		let retryMs = 0;
		while (!this.stopped) {
			let fetched: number;
			this.notified = false;
			try {
				fetched = await this.drainBatch();
				retryMs = 0;
			} catch (error) {
				// The node already has its reply for this block, so it never
				// re-sends it: skipping would leave a hole. Retry the same row; the
				// backlog alert pages if it never clears.
				this.lastError = error instanceof Error ? error.message : String(error);
				retryMs = Math.min(RETRY_MAX_MS, Math.max(RETRY_MIN_MS, retryMs * 2));
				logger.error("Journal applier: block apply failed, retrying", {
					error: this.lastError,
					retryMs,
				});
				await this.sleep(retryMs, false);
				continue;
			}
			if (fetched > 0) continue;
			// A row journaled (or an idle waiter registered) while this pass ran
			// may have missed it: drain again before declaring idle.
			if (this.notified) continue;
			// Take the idle waiters this pass vouches for before awaiting: one
			// that registers during the await came after the drain and waits
			// for the next pass.
			const idle = this.idleWaiters.splice(0);
			await this.settleForeignWaiters();
			for (const resolve of idle) resolve();
			await this.sleep(IDLE_POLL_MS);
		}
	}

	/** Idle wait; `notify` / `waitApplied` cut it short, including a notify
	 *  that landed while the last pass was still running. */
	private sleep(ms: number, interruptible = true): Promise<void> {
		if (interruptible && this.notified) return Promise.resolve();
		return new Promise((resolve) => {
			const done = () => {
				clearTimeout(timer);
				this.wake = null;
				resolve();
			};
			const timer = setTimeout(done, ms);
			if (interruptible) this.wake = done;
		});
	}

	/**
	 * Apply up to one batch under the cluster-wide apply lock, so two indexer
	 * instances never apply concurrently or out of order.
	 */
	private drainBatch(): Promise<number> {
		return this.db.connection().execute(async (conn) => {
			await sql`SELECT pg_advisory_lock(${OBSERVER_APPLY_LOCK_KEY})`.execute(
				conn,
			);
			try {
				const pending = await sql<{ n: number; oldest: Date | null }>`
					SELECT count(*)::int AS n, min(received_at) AS oldest
					  FROM observer_journal
					 WHERE status = 'received' AND path = '/new_block'
					   AND network = ${this.network} AND sequence > ${String(this.floor)}
				`.execute(conn);
				this.backlog = Number(pending.rows[0]?.n ?? 0);
				const oldest = pending.rows[0]?.oldest;
				this.oldestReceivedAt = oldest ? new Date(oldest) : null;
				this.releaseRoom();
				if (this.backlog === 0) return 0;

				const rows = (await conn
					.selectFrom("observer_journal")
					.select(["sequence", "raw_body", "received_at"])
					.where("status", "=", "received")
					.where("path", "=", "/new_block")
					.where("network", "=", this.network)
					.where("sequence", ">", String(this.floor))
					.orderBy("sequence", "asc")
					.limit(BATCH_SIZE)
					.execute()) as JournalRow[];

				for (const [i, row] of rows.entries()) {
					if (this.stopped) return i;
					await this.applyRow(row);
					const next = rows[i + 1];
					this.oldestReceivedAt = next
						? new Date(next.received_at)
						: this.backlog > 0
							? this.oldestReceivedAt
							: null;
				}
				return rows.length;
			} finally {
				await sql`SELECT pg_advisory_unlock(${OBSERVER_APPLY_LOCK_KEY})`.execute(
					conn,
				);
			}
		});
	}

	private async applyRow(row: JournalRow): Promise<void> {
		const sequence = String(row.sequence);
		const receipt: ObserverReceipt = {
			sequence,
			path: "/new_block",
			body: row.raw_body,
			rawBodySha256: "",
		};
		let committed = false;
		let payload: NewBlockPayload | null = null;
		let result: IngestResult;
		try {
			payload = parseObserverBody<NewBlockPayload>(row.raw_body);
			result = await this.ingest(payload);
			committed = true;
			await markObserverProcessed(this.db, receipt, {
				path: "/new_block",
				payload,
				result,
			});
		} catch (error) {
			const waiter = this.waiters.get(sequence);
			// A live caller is still holding the node's request: fail it the way
			// synchronous ingest always did (500, the node re-sends the block).
			// Once derived state committed, retrying is the only correct move —
			// the retry sees `duplicate` and marks the row.
			if (!waiter || committed) throw error;
			await markObserverFailed(this.db, receipt, error).catch((journalError) =>
				logger.error("Failed to mark observer receipt", {
					sequence,
					error: journalError,
				}),
			);
			this.finishRow(sequence);
			this.waiters.delete(sequence);
			waiter.reject(error);
			return;
		}

		this.finishRow(sequence);
		this.appliedTotal++;
		this.lastAppliedHeight = payload.block_height;
		this.lastAppliedAt = Date.now();
		this.lastError = null;
		const waiter = this.waiters.get(sequence);
		if (waiter) {
			this.waiters.delete(sequence);
			waiter.resolve(result);
		}
	}

	private finishRow(sequence: string): void {
		const seq = BigInt(sequence);
		if (seq > this.handledThrough) this.handledThrough = seq;
		this.backlog = Math.max(0, this.backlog - 1);
		this.releaseRoom();
	}

	private releaseRoom(): void {
		if (this.backlog > this.backlogLimit) return;
		for (const resolve of this.roomWaiters.splice(0)) resolve();
	}

	/** Waiters whose rows another instance (or an earlier pass) handled. */
	private async settleForeignWaiters(): Promise<void> {
		for (const sequence of [...this.waiters.keys()]) {
			await this.settleFromJournal(sequence);
		}
	}

	private async settleFromJournal(sequence: string): Promise<void> {
		const row = await this.db
			.selectFrom("observer_journal")
			.select(["status", "result", "error"])
			.where("sequence", "=", sequence)
			.executeTakeFirst()
			.catch(() => undefined);
		if (!row || row.status === "received") return;
		const waiter = this.waiters.get(sequence);
		if (!waiter) return;
		this.waiters.delete(sequence);
		if (row.status === "processed") {
			waiter.resolve(row.result as IngestResult);
		} else {
			waiter.reject(new Error(row.error ?? "observer receipt failed"));
		}
	}
}

export type ReceiveOutcome =
	| { mode: "live"; sequence: string; result: IngestResult }
	| { mode: "catch-up"; sequence: string; block_height: number };

/**
 * `/new_block` for a journaling indexer: append, then reply after the apply
 * (live) or right away (catch-up, subject to backpressure).
 */
export async function receiveNewBlock(
	deps: {
		db?: Kysely<Database>;
		network: string;
		applier: JournalApplier;
		forcedLive: boolean;
		nodeBurnTip: () => number | null;
	},
	input: { body: Uint8Array; source: string },
): Promise<ReceiveOutcome> {
	const db = deps.db ?? getSourceDb();
	const receipt = await appendObserverReceipt(db, {
		network: deps.network,
		path: "/new_block",
		source: input.source,
		body: input.body,
	});
	let payload: NewBlockPayload;
	try {
		payload = parseObserverBody<NewBlockPayload>(receipt.body);
	} catch (error) {
		await markObserverFailed(db, receipt, error).catch(() => {});
		throw error;
	}
	const mode = chooseIngestMode({
		forcedLive: deps.forcedLive,
		backlog: deps.applier.backlog,
		blockBurnHeight: payload.burn_block_height,
		nodeBurnTip: deps.nodeBurnTip(),
	});
	deps.applier.notify();
	if (mode === "live") {
		const result = await deps.applier.waitApplied(receipt.sequence);
		return { mode, sequence: receipt.sequence, result };
	}
	await deps.applier.waitForRoom();
	return {
		mode,
		sequence: receipt.sequence,
		block_height: payload.block_height,
	};
}

/** Highest unapplied `/new_block` sequence: the applier floor after a refused spool. */
export async function highestReceivedSequence(
	db: Kysely<Database>,
	network: string,
): Promise<string | null> {
	const row = await db
		.selectFrom("observer_journal")
		.select(sql<string | null>`max(sequence)::text`.as("max"))
		.where("status", "=", "received")
		.where("path", "=", "/new_block")
		.where("network", "=", network)
		.executeTakeFirst();
	return row?.max ?? null;
}
