import { getDb } from "@secondlayer/shared/db";
import { parseJsonb } from "@secondlayer/shared/db/jsonb";
import { logger } from "@secondlayer/shared/logger";
import { listen } from "@secondlayer/shared/queue/listener";
import { broadcastContext } from "@secondlayer/stacks";
import type {
	BudgetConfig,
	RemoteSignerConfig,
	WorkflowDefinition,
} from "@secondlayer/workflows";
import { createEnforcer } from "./budget/enforcer.ts";
import {
	claimWorkflowJob,
	completeWorkflowJob,
	enqueueWorkflowRun,
	failWorkflowJob,
	getWorkerId,
	isRetryableError,
	recoverStaleWorkflowJobs,
} from "./queue.ts";
import { SignerSecretStore } from "./secrets/store.ts";
import { createBroadcastRuntime } from "./steps/broadcast.ts";
import { createStepContext } from "./steps/context.ts";
import { closeMcpClients } from "./steps/mcp.ts";
import { SleepInterrupt } from "./steps/sleep.ts";
import { startCronScheduler } from "./triggers/cron.ts";
import { checkEventTriggers } from "./triggers/event.ts";

const POLL_INTERVAL_MS = Number.parseInt(
	process.env.WORKFLOW_POLL_INTERVAL_MS ?? "1000",
);

/**
 * Lazy process-scoped `SignerSecretStore`. The store's in-memory cache is
 * shared across runs — HMAC rotation via `sl secrets set` propagates after
 * the 5-minute TTL without requiring a runner restart.
 */
let _secretStore: SignerSecretStore | null = null;
function sharedSecretStore(db: Parameters<typeof createStepContext>[1]) {
	if (!_secretStore) _secretStore = new SignerSecretStore(db);
	return _secretStore;
}

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
			const mod = await import(`${defRow.handler_path}?v=${Date.now()}`);
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

		// Build budget enforcer if the workflow declares any caps. Passed into
		// the step context so `memoize()` can gate before each step + record
		// after; also threaded into the broadcast runtime for chain counters.
		const budget = (def.budget as BudgetConfig | undefined) ?? {};
		const enforcer = createEnforcer({
			db,
			workflowDefinitionId: defRow.id,
			workflow: def.name,
			runId: run.id,
			budget,
		});

		// Create step context with memoization
		const step = createStepContext(run.id, db, enforcer);
		const triggerData = parseJsonb<Record<string, unknown>>(run.trigger_data);

		const ctx = {
			event: triggerData,
			step,
			input: triggerData,
		};

		// Resolve the workflow's owning account via api_keys — needed by the
		// broadcast runtime to look up signer HMAC secrets.
		const apiKeyRow = await db
			.selectFrom("api_keys")
			.select(["account_id"])
			.where("id", "=", defRow.api_key_id)
			.executeTakeFirst();
		const accountId = apiKeyRow?.account_id;

		// Build the broadcast runtime bound to this run. `broadcastContext.run`
		// scopes it via AsyncLocalStorage so concurrent runs don't share state.
		const workflowSigners =
			(def.signers as Record<string, RemoteSignerConfig> | undefined) ?? {};
		const hasSigners = Object.keys(workflowSigners).length > 0;
		const broadcastRuntime =
			hasSigners && accountId
				? createBroadcastRuntime({
						db,
						runId: run.id,
						workflow: def.name,
						workflowSigners,
						accountId,
						secrets: sharedSecretStore(db),
						enforcer,
					})
				: undefined;

		// Execute with timeout
		const timeoutMs = defRow.timeout_ms ?? DEFAULT_TIMEOUT_MS;
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

		const startTime = Date.now();

		const runHandler = () => def.handler(ctx);
		const wrapped = broadcastRuntime
			? () => broadcastContext.run(broadcastRuntime, runHandler)
			: runHandler;

		try {
			await Promise.race([
				wrapped(),
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
			const classification = isRetryableError(err);

			logger.warn("Workflow run failed", {
				runId: run.id,
				workflow: defRow.name,
				error: errorMsg,
				durationMs,
				retryable: classification.retryable,
				reason: classification.reason,
			});

			const retriesConfig = parseJsonb<{
				backoffMs?: number;
				backoffMultiplier?: number;
			}>(defRow.retries_config);
			await failWorkflowJob(
				queueId,
				errorMsg,
				maxAttempts,
				retriesConfig ?? undefined,
				classification,
			);

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

	// PG LISTEN for indexer block notifications → check event triggers
	const stopBlockListener = await listen("indexer:new_block", () => {
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

		await closeMcpClients();
		logger.info("Workflow processor stopped");
	};
}
