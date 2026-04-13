export type WorkflowTemplateCategory = "monitoring" | "defi" | "ops" | "digest";

export interface WorkflowTemplate {
	id: string;
	name: string;
	description: string;
	category: WorkflowTemplateCategory;
	trigger: "event" | "schedule" | "manual";
	code: string;
	prompt: string;
}

export const templates: WorkflowTemplate[] = [
	{
		id: "whale-alert",
		name: "Whale Alert",
		description:
			"Ping Slack whenever a STX transfer above a configurable threshold lands on chain. AI summarises each move before delivery.",
		category: "monitoring",
		trigger: "event",
		code: `import { defineWorkflow } from "@secondlayer/workflows";

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
		const analysis = await ctx.step.ai("analyze", {
			model: "sonnet",
			prompt:
				"Summarise this STX transfer for a human operator — include sender, recipient, amount in STX, and anything notable.",
			schema: {
				summary: { type: "string" },
			},
		});

		await ctx.step.deliver("notify", {
			type: "slack",
			channel: "#whale-alerts",
			text: String(analysis.summary ?? "Large STX transfer detected"),
		});
	},
});
`,
		prompt:
			"Build me a workflow that pings my Slack every time someone transfers more than 100k STX.",
	},
	{
		id: "mint-watcher",
		name: "Mint Watcher",
		description:
			"Track every NFT mint on a specific contract and post a Discord update with the token id and minter.",
		category: "monitoring",
		trigger: "event",
		code: `import { defineWorkflow } from "@secondlayer/workflows";

export default defineWorkflow({
	name: "mint-watcher",
	trigger: {
		type: "event",
		filter: {
			type: "nft_mint",
			// TODO: set assetIdentifier for the collection you want to watch.
		},
	},
	handler: async (ctx) => {
		const summary = await ctx.step.ai("summarise", {
			model: "haiku",
			prompt:
				"Write a one-sentence mint announcement including the minter principal and token id.",
			schema: {
				text: { type: "string" },
			},
		});

		await ctx.step.deliver("announce", {
			type: "discord",
			webhookUrl: "https://discord.com/api/webhooks/REPLACE_ME",
			content: String(summary.text ?? "New NFT mint detected"),
		});
	},
});
`,
		prompt:
			"Watch a specific NFT collection for mints and announce each one in Discord.",
	},
	{
		id: "price-circuit-breaker",
		name: "Price Circuit Breaker",
		description:
			"On every swap, fetch recent activity from a subgraph, and email the team when a pool moves by more than 5% in an hour.",
		category: "defi",
		trigger: "event",
		code: `import { defineWorkflow } from "@secondlayer/workflows";

export default defineWorkflow({
	name: "price-circuit-breaker",
	trigger: {
		type: "event",
		filter: {
			type: "print_event",
			topic: "swap",
		},
	},
	handler: async (ctx) => {
		const recent = await ctx.step.query("recent-swaps", "dex-swaps", "swaps", {
			limit: 50,
			orderBy: { created_at: "desc" },
		});

		const verdict = await ctx.step.ai("check-drift", {
			model: "sonnet",
			prompt:
				"Given the recent swaps below, return breached=true if the pool moved more than 5% in the last hour, with a short reason.",
			schema: {
				breached: { type: "boolean" },
				reason: { type: "string" },
			},
		});
		void recent;

		if (verdict.breached) {
			await ctx.step.deliver("notify", {
				type: "email",
				to: "ops@example.com",
				subject: "Pool drift circuit breaker tripped",
				body: String(verdict.reason ?? ""),
			});
		}
	},
});
`,
		prompt:
			"Email the ops team whenever a pool moves more than 5% in an hour based on recent swap history.",
	},
	{
		id: "daily-digest",
		name: "Daily Digest",
		description:
			"Each morning, summarise the previous day's on-chain activity across your subgraphs and deliver it to Slack.",
		category: "digest",
		trigger: "schedule",
		code: `import { defineWorkflow } from "@secondlayer/workflows";

export default defineWorkflow({
	name: "daily-digest",
	trigger: {
		type: "schedule",
		cron: "0 9 * * *",
		timezone: "UTC",
	},
	handler: async (ctx) => {
		const rows = await ctx.step.query("yesterday", "stx-transfers", "transfers", {
			limit: 500,
			orderBy: { created_at: "desc" },
		});

		const digest = await ctx.step.ai("write-digest", {
			model: "sonnet",
			prompt:
				"Write a 3-bullet Slack digest covering total transfer volume, largest sender, and any unusual activity.",
			schema: {
				summary: { type: "string" },
			},
		});
		void rows;

		await ctx.step.deliver("post", {
			type: "slack",
			channel: "#daily-digest",
			text: String(digest.summary ?? ""),
		});
	},
});
`,
		prompt:
			"Every morning at 9am UTC, summarise yesterday's STX transfers and post the digest to Slack.",
	},
	{
		id: "failed-tx-alert",
		name: "Failed Tx Alert",
		description:
			"Watch a target contract for reverting contract calls and alert a webhook with the error.",
		category: "ops",
		trigger: "event",
		code: `import { defineWorkflow } from "@secondlayer/workflows";

export default defineWorkflow({
	name: "failed-tx-alert",
	trigger: {
		type: "event",
		filter: {
			type: "contract_call",
			// TODO: set contractId and functionName for the target you want to watch.
		},
	},
	handler: async (ctx) => {
		const classification = await ctx.step.ai("classify", {
			model: "haiku",
			prompt:
				"Decide whether this contract call should be treated as a failure. Return failed=true with a short reason if so.",
			schema: {
				failed: { type: "boolean" },
				reason: { type: "string" },
			},
		});

		if (classification.failed) {
			await ctx.step.deliver("notify", {
				type: "webhook",
				url: "https://example.com/incidents",
				body: {
					reason: String(classification.reason ?? ""),
					event: ctx.event,
				},
			});
		}
	},
});
`,
		prompt:
			"Alert our incident webhook whenever a contract call on my target contract fails.",
	},
	{
		id: "health-cron",
		name: "Subgraph Health Cron",
		description:
			"Every 15 minutes, spot-check a subgraph's row counts and page the team over Telegram if indexing has stalled.",
		category: "ops",
		trigger: "schedule",
		code: `import { defineWorkflow } from "@secondlayer/workflows";

export default defineWorkflow({
	name: "health-cron",
	trigger: {
		type: "schedule",
		cron: "*/15 * * * *",
		timezone: "UTC",
	},
	handler: async (ctx) => {
		const count = await ctx.step.count("transfers-count", "stx-transfers", "transfers");

		const assessment = await ctx.step.ai("assess", {
			model: "haiku",
			prompt: "Given the current row count, decide whether indexing is stalled.",
			schema: {
				stalled: { type: "boolean" },
				reason: { type: "string" },
			},
		});
		void count;

		if (assessment.stalled) {
			await ctx.step.deliver("page", {
				type: "telegram",
				botToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
				chatId: "",
				text: String(assessment.reason ?? "Subgraph indexing stalled"),
			});
		}
	},
});
`,
		prompt:
			"Page me on Telegram if my subgraph stops indexing for more than 15 minutes.",
	},
];

export function getTemplateById(id: string): WorkflowTemplate | undefined {
	return templates.find((t) => t.id === id);
}

export function getTemplatesByCategory(
	category: WorkflowTemplateCategory,
): WorkflowTemplate[] {
	return templates.filter((t) => t.category === category);
}
