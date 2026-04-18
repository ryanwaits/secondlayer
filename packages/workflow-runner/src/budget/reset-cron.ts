import { getDb } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";

/**
 * Budget reset cron. Runs every minute. Two responsibilities:
 *
 *  1. **Auto-resume**: workflows paused with `status = "paused:budget"` whose
 *     current period has already rolled over (the row's `reset_at` is in the
 *     past) are flipped back to `active`. The next run tick then picks them
 *     up; budget rows for the new period are upserted lazily by the enforcer.
 *
 *  2. **Prune**: budget rows older than 30 days past `reset_at` are deleted
 *     to stop the table from growing unbounded. Per-run budget rows
 *     (`reset_at = 9999-12-31`) are excluded from pruning — they live until
 *     the run is deleted (cascade via FK).
 */

const POLL_INTERVAL_MS = 60_000;
const RETENTION_DAYS = 30;

export function startBudgetResetCron(): () => void {
	let running = true;

	async function tick() {
		if (!running) return;
		try {
			await resumeBudgetPaused();
			await pruneOldPeriods();
		} catch (err) {
			logger.error("budget reset cron error", {
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	const interval = setInterval(tick, POLL_INTERVAL_MS);
	tick();

	return () => {
		running = false;
		clearInterval(interval);
	};
}

async function resumeBudgetPaused(): Promise<void> {
	const db = getDb();
	// Any workflow paused on budget whose most-recent period has rolled over
	// can be resumed. The enforcer creates a fresh budget row lazily on the
	// next step, so no writes here beyond the status flip.
	const now = new Date();
	const paused = await db
		.selectFrom("workflow_definitions")
		.select(["id", "name"])
		.where("status", "=", "paused:budget")
		.execute();

	for (const row of paused) {
		const latest = await db
			.selectFrom("workflow_budgets")
			.select(["reset_at", "period"])
			.where("workflow_definition_id", "=", row.id)
			.orderBy("created_at", "desc")
			.limit(1)
			.executeTakeFirst();
		if (!latest) continue;
		// If the latest tracked period has already reset, re-activate.
		if (latest.reset_at.getTime() <= now.getTime()) {
			await db
				.updateTable("workflow_definitions")
				.set({ status: "active" })
				.where("id", "=", row.id)
				.where("status", "=", "paused:budget")
				.execute();
			logger.info("budget: auto-resumed paused workflow", {
				workflow: row.name,
				period: latest.period,
			});
		}
	}
}

async function pruneOldPeriods(): Promise<void> {
	const db = getDb();
	const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
	const result = await db
		.deleteFrom("workflow_budgets")
		.where("reset_at", "<", cutoff)
		.where("period", "not like", "per-run:%")
		.executeTakeFirst();
	if ((result.numDeletedRows ?? 0n) > 0n) {
		logger.debug("budget: pruned old period rows", {
			rows: Number(result.numDeletedRows),
		});
	}
}
