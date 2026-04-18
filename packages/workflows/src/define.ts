import type {
	WorkflowContext,
	WorkflowDefinition,
	WorkflowTrigger,
} from "./types.ts";

/**
 * Extract the event payload type carried by a typed trigger's phantom
 * `__event` marker (produced by `@secondlayer/stacks/triggers`). Falls back
 * to `Record<string, unknown>` for untyped triggers, schedule, and manual.
 */
export type InferEventFromTrigger<T> = T extends { __event?: infer E }
	? E extends undefined
		? Record<string, unknown>
		: E
	: Record<string, unknown>;

/**
 * Identity function that preserves trigger type literals for type inference
 * and narrows `ctx.event` in the handler when the trigger was produced by
 * a typed helper (e.g. `on.stxTransfer(…)` from `@secondlayer/stacks/triggers`).
 */
export function defineWorkflow<T extends WorkflowTrigger>(
	def: Omit<WorkflowDefinition, "trigger" | "handler"> & {
		trigger: T;
		handler: (
			ctx: WorkflowContext<InferEventFromTrigger<T>>,
		) => Promise<unknown>;
	},
): Omit<WorkflowDefinition, "trigger" | "handler"> & {
	trigger: T;
	handler: (ctx: WorkflowContext<InferEventFromTrigger<T>>) => Promise<unknown>;
} {
	return def;
}
