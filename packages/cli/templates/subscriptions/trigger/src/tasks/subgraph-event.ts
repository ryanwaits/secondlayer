import { task } from "@trigger.dev/sdk/v3";

/**
 * Task triggered by a Secondlayer subscription. The Secondlayer emitter
 * POSTs to this task's HTTP endpoint; Trigger.dev handles durable
 * execution, retries, and concurrency.
 */
export const onSubgraphEvent = task({
	id: "{{TASK_ID}}",
	run: async (payload: Record<string, unknown>, { ctx: _ctx }) => {
		console.log("[subgraph event]", payload);
		// TODO: your business logic — AI SDK, HTTP, DB, chain broadcasts.
		return { ok: true };
	},
});
