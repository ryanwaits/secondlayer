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
});
