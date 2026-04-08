import { getDb } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import { createWorkflowRun } from "@secondlayer/shared/db/queries/workflows";
import { enqueueWorkflowRun } from "../queue.ts";
import { CronExpressionParser } from "cron-parser";

const POLL_INTERVAL_MS = 60_000; // check every minute

/**
 * Start the cron scheduler background loop.
 * Every 60s, queries due schedules, creates runs, computes next_run_at.
 */
export function startCronScheduler(): () => void {
	let running = true;

	async function tick() {
		if (!running) return;

		try {
			await processDueSchedules();
		} catch (err) {
			logger.error("Cron scheduler error", {
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	const interval = setInterval(tick, POLL_INTERVAL_MS);

	// Run immediately on start
	tick();

	return () => {
		running = false;
		clearInterval(interval);
	};
}

async function processDueSchedules(): Promise<void> {
	const db = getDb();

	const schedules = await db
		.selectFrom("workflow_schedules")
		.selectAll()
		.where("enabled", "=", true)
		.where("next_run_at", "<=", new Date())
		.execute();

	for (const schedule of schedules) {
		try {
			// Verify the definition is still active
			const def = await db
				.selectFrom("workflow_definitions")
				.select(["id", "name", "status"])
				.where("id", "=", schedule.definition_id)
				.executeTakeFirst();

			if (!def || def.status !== "active") {
				// Disable the schedule if definition is gone or inactive
				await db
					.updateTable("workflow_schedules")
					.set({ enabled: false })
					.where("id", "=", schedule.id)
					.execute();
				continue;
			}

			// Create workflow run
			const run = await createWorkflowRun(db, {
				definitionId: schedule.definition_id,
				triggerType: "schedule",
				triggerData: {
					scheduledAt: schedule.next_run_at.toISOString(),
					cronExpr: schedule.cron_expr,
				},
			});

			await enqueueWorkflowRun(run.id);

			// Compute next run time
			const nextRunAt = computeNextRun(
				schedule.cron_expr,
				schedule.timezone,
			);

			await db
				.updateTable("workflow_schedules")
				.set({
					last_run_at: new Date(),
					next_run_at: nextRunAt,
				})
				.where("id", "=", schedule.id)
				.execute();

			logger.info("Cron workflow triggered", {
				workflow: def.name,
				runId: run.id,
				nextRunAt: nextRunAt.toISOString(),
			});
		} catch (err) {
			logger.error("Failed to process cron schedule", {
				scheduleId: schedule.id,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}
}

/** Compute the next occurrence of a cron expression. */
function computeNextRun(cronExpr: string, timezone: string): Date {
	const interval = CronExpressionParser.parse(cronExpr, {
		currentDate: new Date(),
		tz: timezone,
	});

	return interval.next().toDate();
}
