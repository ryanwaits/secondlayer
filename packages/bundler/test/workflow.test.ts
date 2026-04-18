import { describe, expect, it } from "bun:test";
import { bundleWorkflowCode } from "../src/workflow.ts";

const whaleAlertSource = `
import { defineWorkflow } from "@secondlayer/workflows";

export default defineWorkflow({
	name: "whale-alert",
	trigger: {
		type: "event",
		filter: {
			type: "stx_transfer",
			minAmount: 100_000_000_000n,
		},
	},
	handler: async (ctx) => {
		await ctx.step.run("noop", async () => ({ ok: true }));
	},
});
`;

describe("bundleWorkflowCode", () => {
	it("bundles and validates a workflow definition", async () => {
		const result = await bundleWorkflowCode(whaleAlertSource);
		expect(result.name).toBe("whale-alert");
		expect(result.trigger.type).toBe("event");
		expect(result.sourceCode).toBe(whaleAlertSource);
		expect(result.handlerCode.length).toBeGreaterThan(0);
	});

	it("throws on invalid workflow (missing trigger)", async () => {
		const badSource = `
import { defineWorkflow } from "@secondlayer/workflows";
export default { name: "bad", handler: async () => {} };
`;
		await expect(bundleWorkflowCode(badSource)).rejects.toThrow(
			/Validation failed/,
		);
	});

	// Regression: user workflows that build a catalog for `step.render` via
	// `@secondlayer/stacks/ui/schemas` must bundle + eval cleanly. Importing
	// from `/ui` (the React-flavored path) used to produce duplicate Zod
	// copies whose second pass referenced a bare `util` that esbuild left
	// unscoped, yielding `Module evaluation failed: util is not defined`.
	it("bundles a workflow that uses the React-free /ui/schemas path", async () => {
		const source = `
import { defineWorkflow } from "@secondlayer/workflows";
import { defineCatalog, AddressProps } from "@secondlayer/stacks/ui/schemas";
import { z } from "zod";

const whaleUI = defineCatalog({
	components: {
		Address: { props: AddressProps },
		WhaleCard: {
			props: z.object({
				from: z.string(),
				to: z.string(),
				amount: z.string(),
			}),
		},
	},
	actions: {},
});

export default defineWorkflow({
	name: "render-schemas-test",
	trigger: { type: "schedule", cron: "0 0 * * *" },
	handler: async () => {
		void whaleUI;
	},
});
`;
		const result = await bundleWorkflowCode(source);
		expect(result.name).toBe("render-schemas-test");
		expect(result.handlerCode.length).toBeGreaterThan(0);
	});
});
