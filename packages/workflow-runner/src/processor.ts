import type { Database } from "@secondlayer/shared/db";
import { parseJsonb } from "@secondlayer/shared/db/jsonb";
import { logger } from "@secondlayer/shared/logger";
import type { Kysely } from "kysely";
import {
	claimJob,
	classifyError,
	completeJob,
	enqueueWorkflowRun,
	failJob,
	recoverStaleJobs,
	reenqueueRun,
} from "./queue.ts";
import type { WorkflowRegistry } from "./registry.ts";
import { createStepContext } from "./steps/context.ts";
import { SleepInterrupt } from "./steps/sleep.ts";

export interface ProcessorOptions {
	db: Kysely<Database>;
	registry: WorkflowRegistry;
	concurrency: number;
	pollIntervalMs?: number;
	staleRecoveryIntervalMs?: number;
}

/**
 * Start the workflow processor. Polls the queue, claims up to
 * `concurrency` jobs at a time, runs them, completes or fails them. Also
 * periodically recovers jobs from dead workers. Returns a stop function.
 */
export function startWorkflowProcessor(opts: ProcessorOptions): () => void {
	const poll = opts.pollIntervalMs ?? 1000;
	const staleRecovery = opts.staleRecoveryIntervalMs ?? 60_000;

	let stopped = false;
	const inFlight = new Set<Promise<void>>();

	const loop = async () => {
		while (!stopped) {
			if (inFlight.size >= opts.concurrency) {
				await Promise.race(inFlight);
				continue;
			}

			const job = await claimJob(opts.db).catch((err) => {
				logger.error("workflow.claim.error", {
					error: err instanceof Error ? err.message : String(err),
				});
				return null;
			});

			if (!job) {
				await sleep(poll);
				continue;
			}

			const task = handleJob(opts, job).finally(() => {
				inFlight.delete(task);
			});
			inFlight.add(task);
		}
	};

	const recoveryTimer = setInterval(() => {
		recoverStaleJobs(opts.db).catch((err) => {
			logger.error("workflow.recovery.error", {
				error: err instanceof Error ? err.message : String(err),
			});
		});
	}, staleRecovery);

	void loop().catch((err) => {
		logger.error("workflow.processor.fatal", {
			error: err instanceof Error ? err.message : String(err),
		});
	});

	logger.info("Workflow processor started", {
		concurrency: opts.concurrency,
		registeredWorkflows: opts.registry.names(),
	});

	return () => {
		stopped = true;
		clearInterval(recoveryTimer);
	};
}

async function handleJob(
	opts: ProcessorOptions,
	job: Awaited<ReturnType<typeof claimJob>> & object,
): Promise<void> {
	const startTime = Date.now();

	try {
		await opts.db
			.updateTable("workflow_runs")
			.set({ status: "running", started_at: new Date() })
			.where("id", "=", job.runId)
			.execute();

		const def = opts.registry.get(job.workflowName);
		if (!def) {
			await failJob(opts.db, {
				queueId: job.queueId,
				runId: job.runId,
				attempts: job.attempts,
				maxAttempts: job.maxAttempts,
				error: `unknown workflow: ${job.workflowName}`,
				retryable: false,
			});
			return;
		}

		let input: unknown = parseJsonb(job.input);
		if (def.input) {
			const parsed = def.input.safeParse(input);
			if (!parsed.success) {
				await failJob(opts.db, {
					queueId: job.queueId,
					runId: job.runId,
					attempts: job.attempts,
					maxAttempts: job.maxAttempts,
					error: `input validation failed: ${JSON.stringify(parsed.error.issues)}`,
					retryable: false,
				});
				return;
			}
			input = parsed.data;
		}

		const step = createStepContext({
			platformDb: opts.db,
			runId: job.runId,
			enqueueChildRun: async (workflowName, childInput) => {
				const childId = await enqueueWorkflowRun(opts.db, {
					workflowName,
					input: childInput,
				});
				return { runId: childId, workflow: workflowName };
			},
		});

		const output = await def.run({
			input,
			runId: job.runId,
			env: process.env,
			step,
		});

		await opts.db
			.updateTable("workflow_runs")
			.set({
				status: "completed",
				output: output === undefined ? null : JSON.stringify(output),
				completed_at: new Date(),
			})
			.where("id", "=", job.runId)
			.execute();

		await completeJob(opts.db, job.queueId);

		logger.info("workflow.completed", {
			runId: job.runId,
			workflowName: job.workflowName,
			ms: Date.now() - startTime,
		});
	} catch (err) {
		if (err instanceof SleepInterrupt) {
			await reenqueueRun(opts.db, job.runId, err.resumeAt, job.maxAttempts);
			await completeJob(opts.db, job.queueId);
			await opts.db
				.updateTable("workflow_runs")
				.set({ status: "sleeping" })
				.where("id", "=", job.runId)
				.execute();
			return;
		}

		const classification = classifyError(err);
		const message = err instanceof Error ? err.message : String(err);
		logger.error("workflow.handler.error", {
			runId: job.runId,
			workflowName: job.workflowName,
			attempts: job.attempts,
			maxAttempts: job.maxAttempts,
			error: message,
			classification,
		});
		await failJob(opts.db, {
			queueId: job.queueId,
			runId: job.runId,
			attempts: job.attempts,
			maxAttempts: job.maxAttempts,
			error: message,
			retryable: classification.retryable,
		});
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
