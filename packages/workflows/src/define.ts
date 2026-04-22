import type { WorkflowDefinition } from "./types.ts";

/**
 * Identity function that preserves type parameters for inference.
 *
 * ```ts
 * export const myWorkflow = defineWorkflow({
 *   name: "my-workflow",
 *   input: MyInputSchema,              // optional zod type
 *   run: async ({ step, input }) => {
 *     const x = await step.run("load", () => fetch(input.url))
 *     return x
 *   },
 * })
 * ```
 */
export function defineWorkflow<TInput = unknown, TOutput = unknown>(
	def: WorkflowDefinition<TInput, TOutput>,
): WorkflowDefinition<TInput, TOutput> {
	return def;
}
