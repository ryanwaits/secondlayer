import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { getDb } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import type { WorkflowQueueItem, WorkflowRun } from "@secondlayer/shared/db";

const WORKER_ID = `wf-${randomUUID().slice(0, 8)}`;

export function getWorkerId(): string {
	return WORKER_ID;
}

/** Insert a workflow run into the queue for processing. */
export async function enqueueWorkflowRun(
	runId: string,
	scheduledFor?: Date,
): Promise<string> {
	const db = getDb();

	const row = await db
		.insertInto("workflow_queue")
		.values({
			run_id: runId,
			status: "pending",
			scheduled_for: scheduledFor ?? new Date(),
		})
		.returning(["id"])
		.executeTakeFirstOrThrow();

	return row.id;
}

export interface ClaimedJob {
	queueId: string;
	run: WorkflowRun;
	maxAttempts: number;
}

/** Claim the next pending workflow job using SKIP LOCKED. */
export async function claimWorkflowJob(): Promise<ClaimedJob | null> {
	const db = getDb();

	const { rows } = await sql<WorkflowQueueItem>`
		UPDATE workflow_queue
		SET
			status = 'processing',
			locked_at = NOW(),
			locked_by = ${WORKER_ID},
			attempts = attempts + 1
		WHERE id = (
			SELECT id FROM workflow_queue
			WHERE status = 'pending'
				AND scheduled_for <= NOW()
			ORDER BY created_at ASC
			FOR UPDATE SKIP LOCKED
			LIMIT 1
		)
		RETURNING *
	`.execute(db);

	const item = rows[0];
	if (!item) return null;

	const run = await db
		.selectFrom("workflow_runs")
		.selectAll()
		.where("id", "=", item.run_id)
		.executeTakeFirst();

	if (!run) return null;

	return {
		queueId: item.id,
		run,
		maxAttempts: item.max_attempts,
	};
}

/** Mark a workflow queue item as completed. */
export async function completeWorkflowJob(queueId: string): Promise<void> {
	await getDb()
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

/** Fail a workflow queue item. Re-queues if under max attempts. */
export async function failWorkflowJob(
	queueId: string,
	error: string,
	maxAttempts = 3,
): Promise<void> {
	const db = getDb();

	const item = await db
		.selectFrom("workflow_queue")
		.select(["attempts", "run_id"])
		.where("id", "=", queueId)
		.executeTakeFirst();

	if (!item) return;

	if (item.attempts < maxAttempts) {
		await db
			.updateTable("workflow_queue")
			.set({
				status: "pending",
				error,
				locked_at: null,
				locked_by: null,
			})
			.where("id", "=", queueId)
			.execute();
	} else {
		await db
			.updateTable("workflow_queue")
			.set({
				status: "failed",
				error,
				completed_at: new Date(),
				locked_at: null,
				locked_by: null,
			})
			.where("id", "=", queueId)
			.execute();

		// Also mark the run as failed
		await db
			.updateTable("workflow_runs")
			.set({
				status: "failed",
				error,
				completed_at: new Date(),
			})
			.where("id", "=", item.run_id)
			.execute();
	}
}

/** Re-queue stale jobs that have been locked for too long. */
export async function recoverStaleWorkflowJobs(
	thresholdMinutes = 5,
): Promise<number> {
	const db = getDb();

	const { rows } = await sql<{ id: string }>`
		UPDATE workflow_queue
		SET
			status = 'pending',
			locked_at = NULL,
			locked_by = NULL
		WHERE status = 'processing'
			AND locked_at < NOW() - ${`${thresholdMinutes} minutes`}::interval
		RETURNING id
	`.execute(db);

	if (rows.length > 0) {
		logger.warn(`Recovered ${rows.length} stale workflow jobs`);
	}

	return rows.length;
}

/** Send PG NOTIFY for new workflow jobs. */
export async function notifyNewWorkflowJob(runId?: string): Promise<void> {
	const payload = runId ?? "";
	await sql`SELECT pg_notify('workflows:new_job', ${payload})`.execute(
		getDb(),
	);
}
