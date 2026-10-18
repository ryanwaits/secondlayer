import { type Kysely, sql } from "kysely";
import type { ReplayProgress } from "../../schemas/webhooks.ts";
import type { Database, WebhookReplay } from "../types.ts";

/**
 * Stored record of each webhook replay. A replay is `scanning` while the
 * request scans its block range, `running` once its outbox rows exist, `done`
 * when none are pending, `failed` if the scan threw or the process died.
 *
 * Progress while running is `enqueued - pending`, where pending is counted
 * through the existing partial index on pending outbox rows (`webhook_outbox`
 * has no index on `replay_id` on purpose). Rows that gave up are counted once,
 * when the replay finalizes.
 */

/** A `scanning` row older than this is a crashed process, not a live scan. */
const STALE_SCAN_MINUTES = 30;

/** Thrown by {@link beginReplay} when a replay is still scanning for the
 *  webhook. The route maps this to 409; `force` does not bypass it. */
export class ReplayInProgressError extends Error {
	constructor() {
		super("replay already in progress for this webhook");
		this.name = "ReplayInProgressError";
	}
}

const ONE_SCANNING_CONSTRAINT = "webhook_replays_one_scanning";

function isOneScanningConflict(err: unknown): boolean {
	if (!(err instanceof Error)) return false;
	const candidate = err as Error & {
		code?: string;
		constraint?: string;
		constraint_name?: string;
	};
	return (
		candidate.code === "23505" &&
		(candidate.constraint === ONE_SCANNING_CONSTRAINT ||
			candidate.constraint_name === ONE_SCANNING_CONSTRAINT)
	);
}

export async function beginReplay(
	db: Kysely<Database>,
	input: {
		id: string;
		webhookId: string;
		fromBlock: number;
		toBlock: number;
	},
): Promise<void> {
	try {
		await db.transaction().execute(async (trx) => {
			await trx
				.updateTable("webhook_replays")
				.set({
					status: "failed",
					error: "scan interrupted",
					finished_at: sql`now()`,
				})
				.where("webhook_id", "=", input.webhookId)
				.where("status", "=", "scanning")
				.where(
					"started_at",
					"<",
					sql<Date>`now() - ${sql.lit(`${STALE_SCAN_MINUTES} minutes`)}::interval`,
				)
				.execute();
			// Re-running a range reuses its record. A row of this very id that is
			// still scanning is a concurrent scan: the WHERE leaves it untouched and
			// no row comes back.
			const row = await trx
				.insertInto("webhook_replays")
				.values({
					id: input.id,
					webhook_id: input.webhookId,
					from_block: input.fromBlock,
					to_block: input.toBlock,
					status: "scanning",
				})
				.onConflict((oc) =>
					oc
						.column("id")
						.doUpdateSet({
							status: "scanning",
							started_at: sql`now()`,
							finished_at: null,
							error: null,
							total: null,
							delivered: null,
							gave_up: null,
						})
						.where("webhook_replays.status", "<>", "scanning"),
				)
				.returning("id")
				.executeTakeFirst();
			if (!row) throw new ReplayInProgressError();
		});
	} catch (err) {
		if (isOneScanningConflict(err)) throw new ReplayInProgressError();
		throw err;
	}
}

export async function finishScan(
	db: Kysely<Database>,
	id: string,
	counts: { scanned: number; enqueued: number },
): Promise<void> {
	await db
		.updateTable("webhook_replays")
		.set({
			status: "running",
			scanned_count: counts.scanned,
			enqueued_count: sql`enqueued_count + ${counts.enqueued}`,
		})
		.where("id", "=", id)
		.execute();
}

export async function failScan(
	db: Kysely<Database>,
	id: string,
	error: string,
): Promise<void> {
	await db
		.updateTable("webhook_replays")
		.set({ status: "failed", error, finished_at: sql`now()` })
		.where("id", "=", id)
		.execute();
}

/** Outbox rows of this replay still waiting to be delivered or to give up. */
export async function pendingCount(
	db: Kysely<Database>,
	id: string,
): Promise<number> {
	const row = await db
		.selectFrom("webhook_outbox")
		.select(sql<string>`count(*)`.as("n"))
		.where("status", "=", "pending")
		.where("replay_id", "=", id)
		.executeTakeFirstOrThrow();
	return Number(row.n);
}

/** Outbox rows of this replay that gave up. Finalize only; never on a poll. */
export async function deadCount(
	db: Kysely<Database>,
	webhookId: string,
	id: string,
): Promise<number> {
	const row = await db
		.selectFrom("webhook_outbox")
		.select(sql<string>`count(*)`.as("n"))
		.where("webhook_id", "=", webhookId)
		.where("replay_id", "=", id)
		.where("status", "=", "dead")
		.executeTakeFirstOrThrow();
	return Number(row.n);
}

export function progressOf(
	record: WebhookReplay,
	pending: number,
): ReplayProgress {
	const done = record.status === "done";
	const total = done
		? (record.total ?? record.enqueued_count)
		: record.enqueued_count;
	return {
		replayId: record.id,
		webhookId: record.webhook_id,
		status: record.status,
		fromBlock: Number(record.from_block),
		toBlock: Number(record.to_block),
		total,
		processed: done ? total : Math.max(0, total - pending),
		pending: done ? 0 : pending,
		delivered: done ? record.delivered : null,
		gaveUp: done ? record.gave_up : null,
		startedAt: record.started_at.toISOString(),
		finishedAt: record.finished_at ? record.finished_at.toISOString() : null,
		error: record.error,
	};
}

/** Progress for one record, finalizing it once nothing is pending. */
async function progressWithFinalize(
	db: Kysely<Database>,
	record: WebhookReplay,
): Promise<ReplayProgress> {
	if (record.status !== "running") return progressOf(record, 0);
	const pending = await pendingCount(db, record.id);
	if (pending > 0) return progressOf(record, pending);

	const dead = await deadCount(db, record.webhook_id, record.id);
	const finalized = await db
		.updateTable("webhook_replays")
		.set({
			status: "done",
			finished_at: sql`now()`,
			total: sql`enqueued_count`,
			gave_up: dead,
			delivered: sql`enqueued_count - ${dead}`,
		})
		.where("id", "=", record.id)
		.where("status", "=", "running")
		.returningAll()
		.executeTakeFirst();
	if (finalized) return progressOf(finalized, 0);
	// Lost a race to another finalizer (or a requeue): re-read.
	const fresh = await db
		.selectFrom("webhook_replays")
		.selectAll()
		.where("id", "=", record.id)
		.executeTakeFirstOrThrow();
	return progressOf(
		fresh,
		fresh.status === "running" ? await pendingCount(db, fresh.id) : 0,
	);
}

export async function readReplay(
	db: Kysely<Database>,
	webhookId: string,
	id: string,
): Promise<ReplayProgress | null> {
	const record = await db
		.selectFrom("webhook_replays")
		.selectAll()
		.where("id", "=", id)
		.where("webhook_id", "=", webhookId)
		.executeTakeFirst();
	return record ? progressWithFinalize(db, record) : null;
}

/** Replays in progress or started within `sinceHours`, newest first. */
export async function listReplays(
	db: Kysely<Database>,
	input: { webhookIds: string[]; sinceHours: number; limit: number },
): Promise<ReplayProgress[]> {
	if (input.webhookIds.length === 0) return [];
	const cutoff = new Date(Date.now() - input.sinceHours * 3_600_000);
	const records = await db
		.selectFrom("webhook_replays")
		.selectAll()
		.where("webhook_id", "in", input.webhookIds)
		.where((eb) =>
			eb.or([
				eb("status", "in", ["scanning", "running"]),
				eb("started_at", ">", cutoff),
			]),
		)
		.orderBy("started_at", "desc")
		.limit(input.limit)
		.execute();
	return Promise.all(records.map((r) => progressWithFinalize(db, r)));
}

/** Newest replays of one webhook, finalizing any that have drained. */
export async function listWebhookReplays(
	db: Kysely<Database>,
	webhookId: string,
	limit: number,
): Promise<ReplayProgress[]> {
	const records = await db
		.selectFrom("webhook_replays")
		.selectAll()
		.where("webhook_id", "=", webhookId)
		.orderBy("started_at", "desc")
		.limit(limit)
		.execute();
	return Promise.all(records.map((r) => progressWithFinalize(db, r)));
}

/** Retention backstop: finalize every running replay that has drained. */
export async function finalizeReplays(db: Kysely<Database>): Promise<void> {
	const running = await db
		.selectFrom("webhook_replays")
		.selectAll()
		.where("status", "=", "running")
		.execute();
	for (const record of running) await progressWithFinalize(db, record);
}

export async function deadSince(
	db: Kysely<Database>,
	webhookId: string,
	since: Date | null,
): Promise<number> {
	let q = db
		.selectFrom("webhook_outbox")
		.select(sql<string>`count(*)`.as("n"))
		.where("webhook_id", "=", webhookId)
		.where("status", "=", "dead");
	if (since) q = q.where("failed_at", ">=", since);
	return Number((await q.executeTakeFirstOrThrow()).n);
}

export async function knownEventsInRange(
	db: Kysely<Database>,
	webhookId: string,
	from: number,
	to: number,
): Promise<number> {
	const row = await db
		.selectFrom("webhook_outbox")
		.select(sql<string>`count(*)`.as("n"))
		.where("webhook_id", "=", webhookId)
		.where("block_height", ">=", from)
		.where("block_height", "<=", to)
		.executeTakeFirstOrThrow();
	return Number(row.n);
}
