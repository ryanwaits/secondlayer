import type { Database } from "@secondlayer/shared/db";
import { jsonb, parseJsonb } from "@secondlayer/shared/db/jsonb";
import { logger } from "@secondlayer/shared/logger";
import type { Kysely } from "kysely";
import { subStepKey } from "./memoKey.ts";

export interface ToolMemoContext {
	runId: string;
	db: Kysely<Database>;
	parentStepId: string;
	nextIndex: () => number;
}

/**
 * Wrap a record of AI SDK tools so each invocation is persisted as a child
 * `workflow_steps` row under `parentStepId`. On retry, previously successful
 * tool calls return cached results instead of re-invoking `execute`.
 *
 * Assumes tools are idempotent (same args → same result). Two calls with
 * identical (toolName, args) within one parent step dedupe to one row.
 */
export function wrapToolsWithMemo<T extends Record<string, unknown>>(
	tools: T,
	ctx: ToolMemoContext,
): T {
	const wrapped: Record<string, unknown> = {};

	for (const [toolName, tool] of Object.entries(tools)) {
		const t = tool as {
			execute?: (args: unknown, options: unknown) => Promise<unknown>;
		};

		if (!t.execute) {
			wrapped[toolName] = tool;
			continue;
		}

		const originalExecute = t.execute.bind(tool);

		wrapped[toolName] = {
			...(tool as Record<string, unknown>),
			execute: async (args: unknown, options: unknown) => {
				const key = subStepKey(ctx.parentStepId, toolName, args);

				const existing = await ctx.db
					.selectFrom("workflow_steps")
					.selectAll()
					.where("run_id", "=", ctx.runId)
					.where("memo_key", "=", key)
					.executeTakeFirst();

				if (existing?.status === "completed" && existing.output != null) {
					logger.debug(
						`Tool "${toolName}" sub-step cache hit (key=${key.slice(0, 8)}…)`,
					);
					return parseJsonb<unknown>(existing.output);
				}

				const stepRow =
					existing ??
					(await ctx.db
						.insertInto("workflow_steps")
						.values({
							run_id: ctx.runId,
							step_index: ctx.nextIndex(),
							step_id: `${toolName}:${key.slice(0, 8)}`,
							step_type: "tool",
							status: "running",
							input: jsonb(args),
							memo_key: key,
							parent_step_id: ctx.parentStepId,
							started_at: new Date(),
						})
						.returningAll()
						.executeTakeFirstOrThrow());

				const startTime = Date.now();
				try {
					const result = await originalExecute(args, options);
					await ctx.db
						.updateTable("workflow_steps")
						.set({
							status: "completed",
							output: jsonb(result),
							completed_at: new Date(),
							duration_ms: Date.now() - startTime,
						})
						.where("id", "=", stepRow.id)
						.execute();
					return result;
				} catch (err) {
					await ctx.db
						.updateTable("workflow_steps")
						.set({
							status: "failed",
							error: err instanceof Error ? err.message : String(err),
							duration_ms: Date.now() - startTime,
							retry_count: (existing?.retry_count ?? 0) + 1,
						})
						.where("id", "=", stepRow.id)
						.execute();
					throw err;
				}
			},
		};
	}

	return wrapped as T;
}
