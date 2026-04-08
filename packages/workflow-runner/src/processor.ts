import { getDb } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import { listen } from "@secondlayer/shared/queue/listener";
import { parseJsonb } from "@secondlayer/shared/db/jsonb";
import type { WorkflowDefinition } from "@secondlayer/workflows";
import { createStepContext } from "./steps/context.ts";
import { SleepInterrupt } from "./steps/sleep.ts";
import { checkEventTriggers } from "./triggers/event.ts";
import { startCronScheduler } from "./triggers/cron.ts";
import {
	claimWorkflowJob,
	completeWorkflowJob,
	failWorkflowJob,
	enqueueWorkflowRun,
	recoverStaleWorkflowJobs,
	getWorkerId,
} from "./queue.ts";

const POLL_INTERVAL_MS = Number.parseInt(
	process.env.WORKFLOW_POLL_INTERVAL_MS ?? "1000",
);
const RECOVERY_INTERVAL_MS = 60_000;
const STALE_THRESHOLD_MIN = 5;
const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes

export async function startWorkflowProcessor(opts: {
	concurrency: number;
}): Promise<() => Promise<void>> {
	const { concurrency } = opts;
	let activeJobs = 0;
	let running = true;
	const workerId = getWorkerId();

	logger.info(`Workflow processor started (worker: ${workerId})`);

	async function processNextJob(): Promise<boolean> {
		if (!running || activeJobs >= concurrency) return false;

		const claimed = await claimWorkflowJob();
		if (!claimed) return false;

		activeJobs++;

		// Process in background (don't await — allows concurrent processing)
		processJob(claimed.queueId, claimed.run, claimed.maxAttempts)
			.catch((err) => {
				logger.error("Unhandled error in workflow job processing", {
					queueId: claimed.queueId,
					runId: claimed.run.id,
					error: err instanceof Error ? err.message : String(err),
				});
			})
			.finally(() => {
				activeJobs--;
			});

		return true;
	}

	async function processJob(
		queueId: string,
		run: { id: string; definition_id: string; trigger_data: unknown },
		maxAttempts: number,
	): Promise<void> {
		const db = getDb();

		// Load definition
		const defRow = await db
			.selectFrom("workflow_definitions")
			.selectAll()
			.where("id", "=", run.definition_id)
			.executeTakeFirst();

		if (!defRow) {
			await failWorkflowJob(queueId, "Workflow definition not found", 1);
			return;
		}

		if (defRow.status !== "active") {
			await completeWorkflowJob(queueId);
			return;
		}

		// Load handler module
		let def: WorkflowDefinition;
		try {
			const mod = await import(defRow.handler_path);
			def = mod.default ?? mod;
		} catch (err) {
			await failWorkflowJob(
				queueId,
				`Failed to load handler: ${err instanceof Error ? err.message : String(err)}`,
				1,
			);
			return;
		}

		// Mark run as running
		await db
			.updateTable("workflow_runs")
			.set({ status: "running", started_at: new Date() })
			.where("id", "=", run.id)
			.where("status", "in", ["pending", "running"]) // allow re-entry for sleep
			.execute();

		// Create step context with memoization
		const step = createStepContext(run.id, db);
		const triggerData = parseJsonb<Record<string, unknown>>(run.trigger_data);

		const ctx = {
			event: triggerData,
			step,
			input: triggerData,
		};

		// Execute with timeout
		const timeoutMs = defRow.timeout_ms ?? DEFAULT_TIMEOUT_MS;
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

		const startTime = Date.now();

		try {
			await Promise.race([
				def.handler(ctx),
				new Promise<never>((_, reject) => {
					controller.signal.addEventListener("abort", () => {
						reject(new Error(`Workflow timed out after ${timeoutMs}ms`));
					});
				}),
			]);

			clearTimeout(timeoutId);

			// Success
			const durationMs = Date.now() - startTime;
			await db
				.updateTable("workflow_runs")
				.set({
					status: "completed",
					completed_at: new Date(),
					duration_ms: durationMs,
				})
				.where("id", "=", run.id)
				.execute();

			await completeWorkflowJob(queueId);

			logger.info("Workflow run completed", {
				runId: run.id,
				workflow: defRow.name,
				durationMs,
			});
		} catch (err) {
			clearTimeout(timeoutId);

			// Handle SleepInterrupt — re-enqueue with future scheduled_for
			if (err instanceof SleepInterrupt) {
				await completeWorkflowJob(queueId);
				await enqueueWorkflowRun(run.id, err.resumeAt);
				logger.info(`Workflow sleeping until ${err.resumeAt.toISOString()}`, {
					runId: run.id,
					workflow: defRow.name,
				});
				return;
			}

			const errorMsg = err instanceof Error ? err.message : String(err);
			const durationMs = Date.now() - startTime;

			logger.warn("Workflow run failed", {
				runId: run.id,
				workflow: defRow.name,
				error: errorMsg,
				durationMs,
			});

			await failWorkflowJob(queueId, errorMsg, maxAttempts);

			// Update run if permanently failed
			const queueItem = await db
				.selectFrom("workflow_queue")
				.select("status")
				.where("id", "=", queueId)
				.executeTakeFirst();

			if (queueItem?.status === "failed") {
				await db
					.updateTable("workflow_runs")
					.set({
						status: "failed",
						error: errorMsg,
						completed_at: new Date(),
						duration_ms: durationMs,
					})
					.where("id", "=", run.id)
					.execute();
			}
		}
	}

	// Drain pending jobs on each notification or poll tick
	async function drainQueue() {
		while (running && activeJobs < concurrency) {
			const claimed = await processNextJob();
			if (!claimed) break;
		}
	}

	// PG LISTEN for workflow queue wakeups
	const stopQueueListener = await listen("workflows:new_job", () => {
		drainQueue();
	});

	// PG LISTEN for indexer block notifications → check event/stream triggers
	const stopBlockListener = await listen("streams:new_job", () => {
		checkEventTriggers();
	});

	// Start cron scheduler (polls every 60s)
	const stopCron = startCronScheduler();

	// Poll interval as fallback
	const pollInterval = setInterval(() => {
		drainQueue();
	}, POLL_INTERVAL_MS);

	// Recovery loop for stale jobs
	const recoveryInterval = setInterval(() => {
		recoverStaleWorkflowJobs(STALE_THRESHOLD_MIN);
	}, RECOVERY_INTERVAL_MS);

	// Initial drain + trigger check
	drainQueue();
	checkEventTriggers();

	// Return cleanup function
	return async () => {
		running = false;
		clearInterval(pollInterval);
		clearInterval(recoveryInterval);
		stopCron();
		await stopQueueListener();
		await stopBlockListener();

		// Wait for active jobs to finish
		while (activeJobs > 0) {
			await new Promise((r) => setTimeout(r, 500));
		}

		logger.info("Workflow processor stopped");
	};
}
