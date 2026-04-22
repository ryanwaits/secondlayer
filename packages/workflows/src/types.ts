import type { z } from "zod/v4";

/**
 * Durable step primitives — the entire runtime surface authors touch.
 *
 * `run`, `sleep`, and `invoke` are the only three. Everything else — AI
 * calls, HTTP, DB queries, MCP clients, on-chain broadcasts — composes
 * via `step.run`. The runtime earns its keep at the `step` boundary
 * (memoization, retry, budget) and does nothing inside user code.
 */
export interface StepContext {
	/**
	 * Execute a function durably. The first successful result is memoized
	 * against `sha256(stepId + canonicalJSON(stableInputs))` — subsequent
	 * runs of the same workflow return the cached result. Throws propagate
	 * and retry per the workflow's retry policy.
	 */
	run<T>(id: string, fn: () => Promise<T>): Promise<T>;
	/** Pause the workflow. The worker is freed; run resumes after `ms`. */
	sleep(id: string, ms: number): Promise<void>;
	/** Fire-and-forget another workflow by name. Returns `{ runId }`. */
	invoke(
		id: string,
		opts: { workflow: string; input?: unknown },
	): Promise<{ runId: string; workflow: string }>;
}

export interface WorkflowContext<TInput = unknown> {
	input: TInput;
	runId: string;
	env: Record<string, string | undefined>;
}

export type WorkflowHandlerArgs<TInput = unknown> = WorkflowContext<TInput> & {
	step: StepContext;
};

export type WorkflowHandler<TInput = unknown, TOutput = unknown> = (
	args: WorkflowHandlerArgs<TInput>,
) => Promise<TOutput>;

export interface WorkflowDefinition<TInput = unknown, TOutput = unknown> {
	/** Stable identifier used by the runtime to dispatch runs. */
	name: string;
	/** Optional zod schema — validated at enqueue time if present. */
	input?: z.ZodType<TInput>;
	/** The handler. */
	run: WorkflowHandler<TInput, TOutput>;
}

export type WorkflowRunStatus =
	| "queued"
	| "running"
	| "sleeping"
	| "completed"
	| "failed";
