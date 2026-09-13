import { Inngest } from "inngest";

export const inngest = new Inngest({
	id: "{{NAME}}",
});

export const onSubgraphEvent = inngest.createFunction(
	{ id: "on-subgraph-event", name: "On Subgraph Event" },
	{ event: "{{EVENT_NAME}}" },
	async ({ event, step }) => {
		// `event.data` is the row payload delivered by Secondlayer.
		const row = event.data as Record<string, unknown>;
		await step.run("handle", async () => {
			console.log("[subgraph event]", event.name, row);
			// TODO: plug in your business logic — AI SDK, HTTP, DB writes, etc.
			return { ok: true };
		});
	},
);
