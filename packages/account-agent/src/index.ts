import Anthropic from "@anthropic-ai/sdk";
import type { Database } from "@secondlayer/shared/db";
import type { Kysely } from "kysely";
import { SYSTEM_PROMPT } from "./prompt.ts";
import { executeTool, toolDefinitions } from "./tools.ts";
import type { AgentResult, InsightOutput } from "./types.ts";

const HAIKU_INPUT_COST_PER_1K = 0.00025;
const HAIKU_OUTPUT_COST_PER_1K = 0.00125;
const BUDGET_USD = Number.parseFloat(
	process.env.ACCOUNT_AGENT_BUDGET_USD || "0.25",
);

export async function runAccountAgent(
	accountId: string,
	db: Kysely<Database>,
): Promise<AgentResult> {
	// Check daily budget
	const budgetOk = await checkBudget(accountId, db);
	if (!budgetOk) {
		return {
			status: "completed",
			insights_created: 0,
			input_tokens: 0,
			output_tokens: 0,
			cost_usd: 0,
			error: "Daily budget exceeded",
		};
	}

	// Record run start
	const run = await db
		.insertInto("account_agent_runs")
		.values({ account_id: accountId })
		.returningAll()
		.executeTakeFirstOrThrow();

	let totalInputTokens = 0;
	let totalOutputTokens = 0;

	try {
		const client = new Anthropic();

		const messages: Anthropic.MessageParam[] = [
			{
				role: "user",
				content:
					"Analyze this account's data for actionable insights. Call the available tools to gather data, then return your findings as a JSON array.",
			},
		];

		// Agentic loop: let Haiku call tools until it returns a final text response
		let insightsJson: string | null = null;

		for (let turn = 0; turn < 10; turn++) {
			const response = await client.messages.create({
				model: "claude-haiku-4-5-20251001",
				max_tokens: 2048,
				system: SYSTEM_PROMPT,
				tools: toolDefinitions,
				messages,
			});

			totalInputTokens += response.usage.input_tokens;
			totalOutputTokens += response.usage.output_tokens;

			// Check if model wants to use tools
			const toolUseBlocks = response.content.filter(
				(b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
			);
			const textBlocks = response.content.filter(
				(b): b is Anthropic.TextBlock => b.type === "text",
			);

			if (toolUseBlocks.length > 0) {
				// Add assistant message with tool calls
				messages.push({ role: "assistant", content: response.content });

				// Execute tools and add results
				const toolResults: Anthropic.ToolResultBlockParam[] = [];
				for (const block of toolUseBlocks) {
					const result = await executeTool(block.name, accountId, db);
					toolResults.push({
						type: "tool_result",
						tool_use_id: block.id,
						content: JSON.stringify(result),
					});
				}
				messages.push({ role: "user", content: toolResults });
			}

			// If stop_reason is "end_turn", extract final text
			if (response.stop_reason === "end_turn") {
				insightsJson = textBlocks.map((b) => b.text).join("") || null;
				break;
			}
		}

		// Parse insights from response
		const insights = parseInsights(insightsJson);
		const costUsd =
			(totalInputTokens / 1000) * HAIKU_INPUT_COST_PER_1K +
			(totalOutputTokens / 1000) * HAIKU_OUTPUT_COST_PER_1K;

		// Write insights (with dedup + dismiss cooldown)
		const DISMISS_COOLDOWN_MS = 72 * 60 * 60 * 1000; // 72 hours
		let insightsCreated = 0;
		for (const insight of insights) {
			// Skip if an active (non-dismissed, non-expired) insight already exists
			const active = await db
				.selectFrom("account_insights")
				.select("id")
				.where("account_id", "=", accountId)
				.where("insight_type", "=", insight.insight_type)
				.where(
					"resource_id",
					insight.resource_id ? "=" : "is",
					insight.resource_id,
				)
				.where("dismissed_at", "is", null)
				.where((eb) =>
					eb.or([
						eb("expires_at", "is", null),
						eb("expires_at", ">", new Date()),
					]),
				)
				.executeTakeFirst();

			// Skip if dismissed within cooldown window
			const recentlyDismissed = !active
				? await db
						.selectFrom("account_insights")
						.select("id")
						.where("account_id", "=", accountId)
						.where("insight_type", "=", insight.insight_type)
						.where(
							"resource_id",
							insight.resource_id ? "=" : "is",
							insight.resource_id,
						)
						.where("dismissed_at", "is not", null)
						.where(
							"dismissed_at",
							">",
							new Date(Date.now() - DISMISS_COOLDOWN_MS),
						)
						.executeTakeFirst()
				: null;

			if (!active && !recentlyDismissed) {
				await db
					.insertInto("account_insights")
					.values({
						account_id: accountId,
						category: insight.category,
						insight_type: insight.insight_type,
						resource_id: insight.resource_id,
						severity: insight.severity,
						title: insight.title,
						body: insight.body,
						data: JSON.stringify(insight.data),
						expires_at: new Date(insight.expires_at),
					})
					.execute();
				insightsCreated++;
			}
		}

		// Update run record
		await db
			.updateTable("account_agent_runs")
			.set({
				completed_at: new Date(),
				status: "completed",
				input_tokens: totalInputTokens,
				output_tokens: totalOutputTokens,
				cost_usd: costUsd,
				insights_created: insightsCreated,
			})
			.where("id", "=", run.id)
			.execute();

		return {
			status: "completed",
			insights_created: insightsCreated,
			input_tokens: totalInputTokens,
			output_tokens: totalOutputTokens,
			cost_usd: costUsd,
		};
	} catch (err) {
		const errorMsg = err instanceof Error ? err.message : String(err);
		const costUsd =
			(totalInputTokens / 1000) * HAIKU_INPUT_COST_PER_1K +
			(totalOutputTokens / 1000) * HAIKU_OUTPUT_COST_PER_1K;

		await db
			.updateTable("account_agent_runs")
			.set({
				completed_at: new Date(),
				status: "failed",
				input_tokens: totalInputTokens,
				output_tokens: totalOutputTokens,
				cost_usd: costUsd,
				error: errorMsg,
			})
			.where("id", "=", run.id)
			.execute();

		return {
			status: "failed",
			insights_created: 0,
			input_tokens: totalInputTokens,
			output_tokens: totalOutputTokens,
			cost_usd: costUsd,
			error: errorMsg,
		};
	}
}

function parseInsights(text: string | null): InsightOutput[] {
	if (!text) return [];
	try {
		const match = text.match(/\[[\s\S]*\]/);
		if (!match) return [];
		const parsed = JSON.parse(match[0]);
		if (!Array.isArray(parsed)) return [];
		// Basic validation
		return parsed.filter(
			(i: InsightOutput) =>
				i.category &&
				i.insight_type &&
				i.severity &&
				i.title &&
				i.body &&
				i.expires_at,
		);
	} catch {
		return [];
	}
}

async function checkBudget(
	accountId: string,
	db: Kysely<Database>,
): Promise<boolean> {
	const today = new Date();
	today.setHours(0, 0, 0, 0);

	const result = await db
		.selectFrom("account_agent_runs")
		.select((eb) => eb.fn.sum<number>("cost_usd").as("total_cost"))
		.where("account_id", "=", accountId)
		.where("started_at", ">=", today)
		.executeTakeFirst();

	const spent = Number(result?.total_cost) || 0;
	return spent < BUDGET_USD;
}

export type { AgentResult, InsightOutput } from "./types.ts";
