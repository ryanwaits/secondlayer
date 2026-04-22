import { type Kysely, sql } from "kysely";
import type { Database } from "../types.ts";

export interface WorkflowRunListRow {
	id: string;
	workflowName: string;
	status: string;
	startedAt: Date | null;
	completedAt: Date | null;
	createdAt: Date;
	durationMs: number | null;
	stepCount: number;
}

export interface WorkflowStepRow {
	id: string;
	stepId: string;
	status: string;
	attempts: number;
	startedAt: Date | null;
	completedAt: Date | null;
	createdAt: Date;
	durationMs: number | null;
	output: unknown;
	error: string | null;
}

export interface WorkflowRunDetail {
	id: string;
	workflowName: string;
	status: string;
	input: unknown;
	output: unknown;
	error: string | null;
	startedAt: Date | null;
	completedAt: Date | null;
	createdAt: Date;
	accountId: string | null;
	tenantId: string | null;
	steps: WorkflowStepRow[];
}

/**
 * List recent workflow runs produced by a given sentry. Matches on the
 * sentry id stored inside the run's input payload (`input.sentryId`).
 * Account-scoped: uses `workflow_runs.account_id` rather than trusting
 * the route's :id alone.
 */
export async function listRunsForSentry(
	db: Kysely<Database>,
	opts: { sentryId: string; accountId: string; limit?: number },
): Promise<WorkflowRunListRow[]> {
	const limit = opts.limit ?? 20;
	const rows = await sql<{
		id: string;
		workflow_name: string;
		status: string;
		started_at: Date | null;
		completed_at: Date | null;
		created_at: Date;
		step_count: string;
	}>`
		SELECT r.id, r.workflow_name, r.status, r.started_at, r.completed_at, r.created_at,
			(SELECT COUNT(*) FROM workflow_steps s WHERE s.run_id = r.id) AS step_count
		FROM workflow_runs r
		WHERE r.account_id = ${opts.accountId}
			AND r.input->>'sentryId' = ${opts.sentryId}
		ORDER BY r.created_at DESC
		LIMIT ${limit}
	`.execute(db);

	return rows.rows.map((r) => ({
		id: r.id,
		workflowName: r.workflow_name,
		status: r.status,
		startedAt: r.started_at,
		completedAt: r.completed_at,
		createdAt: r.created_at,
		durationMs: durationMs(r.started_at, r.completed_at),
		stepCount: Number(r.step_count),
	}));
}

export async function getRunWithSteps(
	db: Kysely<Database>,
	opts: { runId: string; accountId: string },
): Promise<WorkflowRunDetail | null> {
	const run = await db
		.selectFrom("workflow_runs")
		.selectAll()
		.where("id", "=", opts.runId)
		.where("account_id", "=", opts.accountId)
		.executeTakeFirst();
	if (!run) return null;

	const steps = await db
		.selectFrom("workflow_steps")
		.selectAll()
		.where("run_id", "=", opts.runId)
		.orderBy("created_at", "asc")
		.execute();

	return {
		id: run.id,
		workflowName: run.workflow_name,
		status: run.status,
		input: run.input,
		output: run.output,
		error: run.error,
		startedAt: run.started_at,
		completedAt: run.completed_at,
		createdAt: run.created_at,
		accountId: run.account_id,
		tenantId: run.tenant_id,
		steps: steps.map((s) => ({
			id: s.id,
			stepId: s.step_id,
			status: s.status,
			attempts: s.attempts,
			startedAt: s.started_at,
			completedAt: s.completed_at,
			createdAt: s.created_at,
			durationMs: durationMs(s.started_at, s.completed_at),
			output: s.output,
			error: s.error,
		})),
	};
}

function durationMs(
	started: Date | null,
	completed: Date | null,
): number | null {
	if (!started || !completed) return null;
	return completed.getTime() - started.getTime();
}
