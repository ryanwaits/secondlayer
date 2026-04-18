import type { Catalog } from "@json-render/core";
import type { Database } from "@secondlayer/shared/db";
import { jsonb, parseJsonb } from "@secondlayer/shared/db/jsonb";
import { logger } from "@secondlayer/shared/logger";
import type {
	AIStepOptions,
	DeliverTarget,
	GenerateObjectStepOptions,
	GenerateObjectStepResult,
	GenerateTextStepOptions,
	GenerateTextStepResult,
	InvokeOptions,
	McpStepOptions,
	QueryOptions,
	RenderStepOptions,
	RenderStepResult,
	StepContext,
} from "@secondlayer/workflows";
import type { Kysely } from "kysely";
// run.ts is called inline via memoize, not imported directly
import {
	executeAiStep,
	executeGenerateObject,
	executeGenerateText,
} from "./ai.ts";
import { executeDeliverStep } from "./deliver.ts";
import { executeInvokeStep } from "./invoke.ts";
import { executeMcpStep } from "./mcp.ts";
import { memoKey } from "./memoKey.ts";
import { executeCountStep, executeQueryStep } from "./query.ts";
import { executeRenderStep } from "./render.ts";
import { SleepInterrupt } from "./sleep.ts";
import { wrapToolsWithMemo } from "./toolMemo.ts";

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
		execute: (parentStepId: string) => Promise<T>,
	): Promise<T> {
		const currentIndex = stepIndex++;

		// v2: memoize by hash of (stepId, canonicalJSON(input)) so prompt /
		// config edits in source invalidate the cache on the next run. See
		// `steps/memoKey.ts` for the per-primitive spec.
		const key = memoKey(stepId, input);

		const existing = await db
			.selectFrom("workflow_steps")
			.selectAll()
			.where("run_id", "=", runId)
			.where("memo_key", "=", key)
			.executeTakeFirst();

		if (existing?.status === "completed" && existing.output != null) {
			logger.debug(
				`Step "${stepId}" memoized (key=${key.slice(0, 8)}…), returning cached output`,
			);
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
						memo_key: key,
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
			const result = await execute(stepRow.id);
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
			const errorMsg = err instanceof Error ? err.message : String(err);

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
		run: <T>(id: string, fn: () => Promise<T>) => memoize(id, "run", null, fn),

		ai: (id: string, options: AIStepOptions) =>
			memoize(
				id,
				"ai",
				{ prompt: options.prompt, model: options.model },
				async () => {
					const result = await executeAiStep(options);
					await updateAiTokens(id, result.tokensUsed);
					return result.output;
				},
			),

		generateObject: <T>(
			id: string,
			options: GenerateObjectStepOptions<T>,
		): Promise<GenerateObjectStepResult<T>> =>
			memoize(
				id,
				"generateObject",
				{
					prompt: options.prompt,
					system: options.system,
					model: typeof options.model === "string" ? options.model : undefined,
				},
				async () => {
					const result = await executeGenerateObject({
						model: options.model,
						schema: options.schema as never,
						prompt: options.prompt,
						system: options.system,
					});
					await updateAiTokens(id, result.usage.totalTokens);
					return { object: result.object as T, usage: result.usage };
				},
			),

		render: <C extends Catalog>(
			id: string,
			catalog: C,
			options: RenderStepOptions,
		): Promise<RenderStepResult<C["_specType"]>> =>
			memoize(
				id,
				"render",
				{
					prompt: options.prompt,
					system: options.system,
					model: typeof options.model === "string" ? options.model : undefined,
					context: options.context,
					catalogComponents: catalog.componentNames,
				},
				async () => {
					const result = await executeRenderStep(catalog, options);
					await updateAiTokens(id, result.usage.totalTokens);
					return result as RenderStepResult<C["_specType"]>;
				},
			),

		generateText: (
			id: string,
			options: GenerateTextStepOptions,
		): Promise<GenerateTextStepResult> =>
			memoize(
				id,
				"generateText",
				{
					prompt: options.prompt,
					system: options.system,
					model: typeof options.model === "string" ? options.model : undefined,
					maxSteps: options.maxSteps,
				},
				async (parentStepId) => {
					// Wrap tools so each call persists as a child workflow_steps row;
					// on parent retry, successful tool calls hit cache.
					const tools = options.tools
						? wrapToolsWithMemo(options.tools as Record<string, unknown>, {
								runId,
								db,
								parentStepId,
								nextIndex: () => stepIndex++,
							})
						: undefined;

					const result = await executeGenerateText({
						model: options.model,
						prompt: options.prompt,
						system: options.system,
						tools,
						maxSteps: options.maxSteps,
					});
					await updateAiTokens(id, result.usage.totalTokens);
					return result;
				},
			),

		query: (
			id: string,
			subgraph: string,
			table: string,
			options?: QueryOptions,
		) =>
			memoize(id, "query", { subgraph, table, ...options }, () =>
				executeQueryStep(db, subgraph, table, options),
			),

		count: (
			id: string,
			subgraph: string,
			table: string,
			where?: Record<string, unknown>,
		) =>
			memoize(id, "count", { subgraph, table, where }, () =>
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
			memoize(
				id,
				"mcp",
				{ server: options.server, tool: options.tool, args: options.args },
				() => executeMcpStep(options),
			),
	};
}
