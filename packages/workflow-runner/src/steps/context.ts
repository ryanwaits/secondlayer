import type { Kysely } from "kysely";
import type { Database } from "@secondlayer/shared/db";
import type {
	StepContext,
	AIStepOptions,
	DeliverTarget,
	QueryOptions,
	InvokeOptions,
	McpStepOptions,
} from "@secondlayer/workflows";
import { jsonb, parseJsonb } from "@secondlayer/shared/db/jsonb";
import { logger } from "@secondlayer/shared/logger";
// run.ts is called inline via memoize, not imported directly
import { executeAiStep } from "./ai.ts";
import { executeQueryStep, executeCountStep } from "./query.ts";
import { executeDeliverStep } from "./deliver.ts";
import { executeInvokeStep } from "./invoke.ts";
import { executeMcpStep } from "./mcp.ts";
import { SleepInterrupt } from "./sleep.ts";

/**
 * Create a StepContext that memoizes completed steps.
 * Each step.run/ai/query/deliver call:
 * 1. Checks workflow_steps for a completed row with matching (run_id, step_id)
 * 2. If found → return cached output (memoized)
 * 3. If not → insert row, execute, persist output
 */
export function createStepContext(
	runId: string,
	db: Kysely<Database>,
): StepContext {
	let stepIndex = 0;

	async function memoize<T>(
		stepId: string,
		stepType: string,
		input: unknown,
		execute: () => Promise<T>,
	): Promise<T> {
		const currentIndex = stepIndex++;

		// Check for memoized result
		const existing = await db
			.selectFrom("workflow_steps")
			.selectAll()
			.where("run_id", "=", runId)
			.where("step_id", "=", stepId)
			.executeTakeFirst();

		if (existing?.status === "completed" && existing.output != null) {
			logger.debug(`Step "${stepId}" memoized, returning cached output`);
			return parseJsonb<T>(existing.output);
		}

		// Insert or update step row
		const stepRow = existing
			? existing
			: await db
					.insertInto("workflow_steps")
					.values({
						run_id: runId,
						step_index: currentIndex,
						step_id: stepId,
						step_type: stepType,
						status: "running",
						input: input != null ? jsonb(input) : null,
						started_at: new Date(),
					})
					.returningAll()
					.executeTakeFirstOrThrow();

		if (!existing) {
			// Already inserted above
		} else if (existing.status !== "completed") {
			await db
				.updateTable("workflow_steps")
				.set({ status: "running", started_at: new Date() })
				.where("id", "=", existing.id)
				.execute();
		}

		const startTime = Date.now();

		try {
			const result = await execute();
			const durationMs = Date.now() - startTime;

			await db
				.updateTable("workflow_steps")
				.set({
					status: "completed",
					output: jsonb(result),
					completed_at: new Date(),
					duration_ms: durationMs,
				})
				.where("id", "=", stepRow.id)
				.execute();

			return result;
		} catch (err) {
			const durationMs = Date.now() - startTime;
			const errorMsg =
				err instanceof Error ? err.message : String(err);

			// Re-throw SleepInterrupt without marking as failed
			if (err instanceof SleepInterrupt) {
				await db
					.updateTable("workflow_steps")
					.set({
						status: "completed",
						output: jsonb({ sleepUntil: err.resumeAt.toISOString() }),
						completed_at: new Date(),
						duration_ms: durationMs,
					})
					.where("id", "=", stepRow.id)
					.execute();
				throw err;
			}

			await db
				.updateTable("workflow_steps")
				.set({
					status: "failed",
					error: errorMsg,
					duration_ms: durationMs,
					retry_count: (existing?.retry_count ?? 0) + 1,
				})
				.where("id", "=", stepRow.id)
				.execute();

			throw err;
		}
	}

	async function updateAiTokens(stepId: string, tokens: number) {
		await db
			.updateTable("workflow_steps")
			.set({ ai_tokens_used: tokens })
			.where("run_id", "=", runId)
			.where("step_id", "=", stepId)
			.execute();

		// Accumulate in run
		const result = await db
			.selectFrom("workflow_steps")
			.select(db.fn.sum<number>("ai_tokens_used").as("total"))
			.where("run_id", "=", runId)
			.executeTakeFirst();

		const total = Number(result?.total ?? 0);
		await db
			.updateTable("workflow_runs")
			.set({ total_ai_tokens: total })
			.where("id", "=", runId)
			.execute();
	}

	return {
		run: <T>(id: string, fn: () => Promise<T>) =>
			memoize(id, "run", null, fn),

		ai: (id: string, options: AIStepOptions) =>
			memoize(id, "ai", { prompt: options.prompt, model: options.model }, async () => {
				const result = await executeAiStep(options);
				await updateAiTokens(id, result.tokensUsed);
				return result.output;
			}),

		query: (subgraph: string, table: string, options?: QueryOptions) =>
			memoize(`query:${subgraph}/${table}`, "query", { subgraph, table, ...options }, () =>
				executeQueryStep(db, subgraph, table, options),
			),

		count: (subgraph: string, table: string, where?: Record<string, unknown>) =>
			memoize(`count:${subgraph}/${table}`, "count", { subgraph, table, where }, () =>
				executeCountStep(db, subgraph, table, where),
			),

		deliver: (id: string, target: DeliverTarget) =>
			memoize(id, "deliver", target, () => executeDeliverStep(target)),

		sleep: (id: string, ms: number) =>
			memoize(id, "sleep", { ms }, async () => {
				const resumeAt = new Date(Date.now() + ms);
				throw new SleepInterrupt(resumeAt);
			}),

		invoke: (id: string, options: InvokeOptions) =>
			memoize(id, "invoke", options, () => executeInvokeStep(db, options)),

		mcp: (id: string, options: McpStepOptions) =>
			memoize(id, "mcp", { server: options.server, tool: options.tool, args: options.args }, () =>
				executeMcpStep(options),
			),
	};
}
