import type { Database } from "@secondlayer/shared/db";
import { jsonb } from "@secondlayer/shared/db/jsonb";
import type { StepContext } from "@secondlayer/workflows";
import type { Kysely } from "kysely";
import { memoKey } from "./memoKey.ts";
import { SleepInterrupt } from "./sleep.ts";

export interface StepRuntime {
	platformDb: Kysely<Database>;
	runId: string;
	enqueueChildRun: (
		workflowName: string,
		input: unknown,
	) => Promise<{ runId: string; workflow: string }>;
}

/**
 * Build a `step` object for a single run.
 *
 * Memoization: on every step, we compute the memo key, check the
 * `workflow_steps` row by `(run_id, memo_key)`. If completed → return
 * cached output. Otherwise execute, persist, return.
 *
 * Retry: on throw, step row is left `failed` with the error message. The
 * retry lives at the run level — the queue re-enqueues the whole run and
 * previously-completed steps hit the cache.
 */
export function createStepContext(runtime: StepRuntime): StepContext {
	return {
		async run<T>(id: string, fn: () => Promise<T>): Promise<T> {
			const key = memoKey(id, { id });
			const cached = await getCachedStep<T>(runtime, key);
			if (cached.hit) return cached.output;

			const started = new Date();
			try {
				const output = await fn();
				await persistStep(runtime, {
					stepId: id,
					memoKey: key,
					status: "completed",
					output,
					startedAt: started,
				});
				return output;
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				await persistStep(runtime, {
					stepId: id,
					memoKey: key,
					status: "failed",
					error: message,
					startedAt: started,
				});
				throw err;
			}
		},

		async sleep(id: string, ms: number): Promise<void> {
			const key = memoKey(id, { ms });
			const cached = await getCachedStep<null>(runtime, key);
			if (cached.hit) return;

			// First time this step executes — persist the step as completed,
			// then throw SleepInterrupt so the processor re-queues the run with
			// scheduled_for = now + ms. On resume, the memoized step hits.
			await persistStep(runtime, {
				stepId: id,
				memoKey: key,
				status: "completed",
				output: null,
				startedAt: new Date(),
			});
			throw new SleepInterrupt(new Date(Date.now() + ms));
		},

		async invoke(
			id: string,
			opts: { workflow: string; input?: unknown },
		): Promise<{ runId: string; workflow: string }> {
			const key = memoKey(id, { workflow: opts.workflow, input: opts.input });
			const cached = await getCachedStep<{ runId: string; workflow: string }>(
				runtime,
				key,
			);
			if (cached.hit) return cached.output;

			const started = new Date();
			const childRef = await runtime.enqueueChildRun(
				opts.workflow,
				opts.input ?? {},
			);
			await persistStep(runtime, {
				stepId: id,
				memoKey: key,
				status: "completed",
				output: childRef,
				startedAt: started,
			});
			return childRef;
		},
	};
}

type CachedStep<T> = { hit: true; output: T } | { hit: false };

async function getCachedStep<T>(
	runtime: StepRuntime,
	key: string,
): Promise<CachedStep<T>> {
	const row = await runtime.platformDb
		.selectFrom("workflow_steps")
		.select(["output", "status"])
		.where("run_id", "=", runtime.runId)
		.where("memo_key", "=", key)
		.executeTakeFirst();
	if (!row || row.status !== "completed") {
		return { hit: false };
	}
	return { hit: true, output: row.output as T };
}

async function persistStep(
	runtime: StepRuntime,
	input: {
		stepId: string;
		memoKey: string;
		status: "completed" | "failed";
		output?: unknown;
		error?: string;
		startedAt: Date;
	},
): Promise<void> {
	const now = new Date();
	const outputValue =
		input.output !== undefined
			? jsonb(input.output as Record<string, unknown>)
			: null;
	await runtime.platformDb
		.insertInto("workflow_steps")
		.values({
			run_id: runtime.runId,
			step_id: input.stepId,
			memo_key: input.memoKey,
			status: input.status,
			output: outputValue,
			error: input.error ?? null,
			attempts: 1,
			started_at: input.startedAt,
			completed_at: now,
		})
		.onConflict((oc) =>
			oc.columns(["run_id", "memo_key"]).doUpdateSet({
				status: input.status,
				output: outputValue,
				error: input.error ?? null,
				completed_at: now,
			}),
		)
		.execute();
}
