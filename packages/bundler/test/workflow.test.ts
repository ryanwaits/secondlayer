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

	// Sprint 4: deploy-time AST lint flags broadcast() inside tool() without
	// safety caps.
	it("rejects an AI-drainable broadcast inside a tool body", async () => {
		const source = `
import { defineWorkflow } from "@secondlayer/workflows";
import { tool } from "ai";
import { broadcast, tx } from "@secondlayer/stacks";
import { z } from "zod";

const pay = tool({
	description: "pay arbitrary recipient",
	inputSchema: z.object({ to: z.string(), amount: z.bigint() }),
	execute: async ({ to, amount }) =>
		broadcast(tx.transfer({ recipient: to, amount }), { signer: "treasury" }),
});

export default defineWorkflow({
	name: "drain-risk",
	trigger: { type: "schedule", cron: "0 0 * * *" },
	handler: async () => { void pay; },
});
`;
		await expect(bundleWorkflowCode(source)).rejects.toThrow(
			/Unsafe broadcast detected/,
		);
	});

	it("allows broadcast inside tool() when maxMicroStx + maxFee are set", async () => {
		const source = `
import { defineWorkflow } from "@secondlayer/workflows";
import { tool } from "ai";
import { broadcast, tx } from "@secondlayer/stacks";
import { z } from "zod";

const pay = tool({
	description: "pay with cap",
	inputSchema: z.object({ to: z.string(), amount: z.bigint() }),
	execute: async ({ to, amount }) =>
		broadcast(tx.transfer({ recipient: to, amount }), {
			signer: "treasury",
			maxMicroStx: 50_000_000n,
			maxFee: 5_000n,
		}),
});

export default defineWorkflow({
	name: "capped-pay",
	trigger: { type: "schedule", cron: "0 0 * * *" },
	handler: async () => { void pay; },
});
`;
		const result = await bundleWorkflowCode(source);
		expect(result.name).toBe("capped-pay");
	});

	// Sprint 3: exercise the Stacks pillar — typed trigger narrows event, tools
	// drop into step.generateText, tx.* intents exist ahead of broadcast.
	it("bundles a workflow using /triggers, /tools, and /tx", async () => {
		const source = `
import { defineWorkflow } from "@secondlayer/workflows";
import { on } from "@secondlayer/stacks/triggers";
import { tx } from "@secondlayer/stacks/tx";

export default defineWorkflow({
	name: "stacks-pillar-test",
	trigger: on.stxTransfer({ minAmount: 100_000_000_000n }),
	handler: async ({ event, step }) => {
		// event is typed as StxTransferEvent — sender/recipient/amount available.
		const intent = tx.transfer({
			recipient: event.recipient,
			amount: event.amount,
		});
		await step.run("noop", async () => {
			void intent;
			return { ok: true };
		});
	},
});
`;
		const result = await bundleWorkflowCode(source);
		expect(result.name).toBe("stacks-pillar-test");
		expect(result.trigger.type).toBe("event");
	});
});
