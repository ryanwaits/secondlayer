import type { WorkflowDefinition, WorkflowTrigger } from "./types.ts";

/**
 * Identity function that preserves trigger type literals for type inference.
 */
export function defineWorkflow<T extends WorkflowTrigger>(
	def: Omit<WorkflowDefinition, "trigger"> & { trigger: T },
): Omit<WorkflowDefinition, "trigger"> & { trigger: T } {
	return def;
}
