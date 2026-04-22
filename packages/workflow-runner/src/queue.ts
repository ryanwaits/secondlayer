import { randomUUID } from "node:crypto";
import type { Database } from "@secondlayer/shared/db";
import { jsonb } from "@secondlayer/shared/db/jsonb";
import { logger } from "@secondlayer/shared/logger";
import type { Kysely } from "kysely";
import { sql } from "kysely";

const WORKER_ID = `wfr-${randomUUID().slice(0, 8)}`;

export function getWorkerId(): string {
	return WORKER_ID;
}

/**
 * Enqueue a workflow run. Inserts one row in `workflow_runs` and one
 * matching row in `workflow_queue`. Returns the run id.
 */
export async function enqueueWorkflowRun(
	db: Kysely<Database>,
	opts: {
		workflowName: string;
		input?: unknown;
		scheduledFor?: Date;
		maxAttempts?: number;
	},
): Promise<string> {
	const run = await db
		.insertInto("workflow_runs")
		.values({
			workflow_name: opts.workflowName,
			input: jsonb((opts.input ?? {}) as Record<string, unknown>),
			status: "queued",
		})
		.returning(["id"])
		.executeTakeFirstOrThrow();

	await db
		.insertInto("workflow_queue")
		.values({
			run_id: run.id,
			status: "pending",
			scheduled_for: opts.scheduledFor ?? new Date(),
			max_attempts: opts.maxAttempts ?? 3,
		})
		.execute();

	return run.id;
}

/**
 * Re-enqueue an existing run — used by `step.sleep` to resume after the
 * sleep interval. Does NOT create a new `workflow_runs` row; just a new
 * queue entry with `scheduled_for = resumeAt`.
 */
export async function reenqueueRun(
	db: Kysely<Database>,
	runId: string,
	resumeAt: Date,
	maxAttempts = 3,
): Promise<void> {
	await db
		.insertInto("workflow_queue")
		.values({
			run_id: runId,
			status: "pending",
			scheduled_for: resumeAt,
			max_attempts: maxAttempts,
		})
		.execute();
}

export interface ClaimedJob {
	queueId: string;
	runId: string;
	attempts: number;
	maxAttempts: number;
	workflowName: string;
	input: unknown;
}

/** Claim the next pending job using SKIP LOCKED. */
export async function claimJob(
	db: Kysely<Database>,
): Promise<ClaimedJob | null> {
	const result = await sql<{
		id: string;
		run_id: string;
		attempts: number;
		max_attempts: number;
		workflow_name: string;
		input: unknown;
	}>`
		WITH claimed AS (
			UPDATE workflow_queue
			SET
				status = 'processing',
				locked_at = NOW(),
				locked_by = ${WORKER_ID},
				attempts = attempts + 1
			WHERE id = (
				SELECT id FROM workflow_queue
				WHERE status = 'pending' AND scheduled_for <= NOW()
				ORDER BY scheduled_for ASC
				FOR UPDATE SKIP LOCKED
				LIMIT 1
			)
			RETURNING id, run_id, attempts, max_attempts
		)
		SELECT c.id, c.run_id, c.attempts, c.max_attempts,
			r.workflow_name, r.input
		FROM claimed c
		JOIN workflow_runs r ON r.id = c.run_id
	`.execute(db);

	const row = result.rows[0];
	if (!row) return null;

	return {
		queueId: row.id,
		runId: row.run_id,
		attempts: row.attempts,
		maxAttempts: row.max_attempts,
		workflowName: row.workflow_name,
		input: row.input,
	};
}

export async function completeJob(
	db: Kysely<Database>,
	queueId: string,
): Promise<void> {
	await db
		.updateTable("workflow_queue")
		.set({
			status: "completed",
			completed_at: new Date(),
			locked_at: null,
			locked_by: null,
		})
		.where("id", "=", queueId)
		.execute();
}

/**
 * Fail a job. If attempts < maxAttempts and error is retryable, re-queue
 * with exponential backoff. Otherwise mark the run failed.
 */
export async function failJob(
	db: Kysely<Database>,
	opts: {
		queueId: string;
		runId: string;
		attempts: number;
		maxAttempts: number;
		error: string;
		retryable: boolean;
	},
): Promise<void> {
	const canRetry = opts.retryable && opts.attempts < opts.maxAttempts;

	if (canRetry) {
		const delayMs = 1000 * 2 ** (opts.attempts - 1);
		await db
			.updateTable("workflow_queue")
			.set({
				status: "pending",
				error: opts.error,
				scheduled_for: new Date(Date.now() + delayMs),
				locked_at: null,
				locked_by: null,
			})
			.where("id", "=", opts.queueId)
			.execute();
		return;
	}

	await db
		.updateTable("workflow_queue")
		.set({
			status: "failed",
			error: opts.error,
			completed_at: new Date(),
			locked_at: null,
			locked_by: null,
		})
		.where("id", "=", opts.queueId)
		.execute();

	await db
		.updateTable("workflow_runs")
		.set({
			status: "failed",
			error: opts.error,
			completed_at: new Date(),
		})
		.where("id", "=", opts.runId)
		.execute();
}

/** Recover jobs locked by a dead worker. */
export async function recoverStaleJobs(
	db: Kysely<Database>,
	thresholdMinutes = 5,
): Promise<number> {
	const result = await sql<{ id: string }>`
		UPDATE workflow_queue
		SET status = 'pending', locked_at = NULL, locked_by = NULL
		WHERE status = 'processing'
			AND locked_at < NOW() - ${`${thresholdMinutes} minutes`}::interval
		RETURNING id
	`.execute(db);
	if (result.rows.length > 0) {
		logger.warn("Recovered stale workflow jobs", {
			count: result.rows.length,
		});
	}
	return result.rows.length;
}

export function classifyError(err: unknown): {
	retryable: boolean;
	reason: string;
} {
	if (
		err != null &&
		typeof err === "object" &&
		"isRetryable" in err &&
		typeof (err as { isRetryable: unknown }).isRetryable === "boolean"
	) {
		const retryable = (err as { isRetryable: boolean }).isRetryable;
		const name =
			"name" in err && typeof (err as { name: unknown }).name === "string"
				? (err as { name: string }).name
				: "Error";
		return {
			retryable,
			reason: retryable
				? `${name} marked retryable`
				: `${name} is non-retryable`,
		};
	}
	return { retryable: true, reason: "defaulting to retryable" };
}
