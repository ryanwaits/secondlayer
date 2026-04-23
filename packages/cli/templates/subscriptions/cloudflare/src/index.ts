import {
	WorkflowEntrypoint,
	type WorkflowEvent,
	type WorkflowStep,
} from "cloudflare:workers";

interface Params {
	_type: string;
	_outboxId: string;
	[k: string]: unknown;
}

export class OnSubgraphEvent extends WorkflowEntrypoint<Env, Params> {
	async run(event: WorkflowEvent<Params>, step: WorkflowStep): Promise<void> {
		const params = event.payload;
		await step.do("handle", async () => {
			console.log("[subgraph event]", params._type, params);
			// TODO: plug in your business logic.
			return { ok: true };
		});
	}
}

interface Env {
	MY_WORKFLOW: Workflow<Params>;
}

export default {
	async fetch(_req: Request): Promise<Response> {
		return new Response(
			"This worker is a Workflow receiver — trigger it via the Cloudflare API.",
		);
	},
};
