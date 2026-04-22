import { createHash } from "node:crypto";
import { getSourceDb } from "@secondlayer/shared/db";
import { getDb } from "@secondlayer/shared/db";
import {
	insertAlert,
	touchLastCheck,
	updateAlertDelivery,
} from "@secondlayer/shared/db/queries/sentries";
import { defineWorkflow } from "@secondlayer/workflows";
import { anthropic } from "@secondlayer/workflows/ai";
import { generateObject } from "ai";
import { sql } from "kysely";
import { z } from "zod/v4";
import { postToWebhook } from "../delivery.ts";
import type { SlackMessage } from "../types.ts";

/**
 * Print-event-match sentry — alert on specific `(contract, topic)`
 * print events (Clarity `print`). Enables custom DeFi alerts without
 * writing code: the user names a contract + optional topic string,
 * and any successful print matching fires an alert. Typical uses:
 * liquidations, pool drains, governance proposals, oracle failures.
 */

export interface PrintEventMatchInput {
	sentryId: string;
	/** Contract identifier (principal.contract-name). */
	principal: string;
	/** Optional topic string to filter by. If omitted, all prints on the contract match. */
	topic: string | null;
	deliveryWebhook: string;
	sinceIso: string | null;
	testMode?: boolean;
}

export const PrintEventMatchInputSchema: z.ZodType<PrintEventMatchInput> =
	z.object({
		sentryId: z.string().uuid(),
		principal: z.string().min(28),
		topic: z.string().max(128).nullable(),
		deliveryWebhook: z.string().url(),
		sinceIso: z.string().nullable(),
		testMode: z.boolean().optional(),
	});

interface Match {
	txId: string;
	eventIndex: number;
	blockHeight: number;
	contractIdentifier: string;
	topic: string;
	value: unknown;
}

interface Triage {
	severity: "low" | "med" | "high";
	summary: string;
	likelyCause: string;
}

const TriageSchema = z.object({
	severity: z.enum(["low", "med", "high"]),
	summary: z.string().min(1).max(400),
	likelyCause: z.string().min(1).max(200),
});

const INITIAL_LOOKBACK_MS = 60 * 60 * 1000;

function idempotencyKey(match: Match): string {
	return createHash("sha256")
		.update(`${match.txId}:${match.eventIndex}`)
		.digest("hex");
}

function shortHash(s: string, n = 8): string {
	return s.length <= n * 2 + 3 ? s : `${s.slice(0, n)}…${s.slice(-n)}`;
}

function formatAlert(
	input: PrintEventMatchInput,
	match: Match,
	triage: Triage,
	prefix: string,
): SlackMessage {
	const emoji =
		triage.severity === "high" ? "🚨" : triage.severity === "med" ? "⚠️" : "📡";
	const text = `${prefix}${emoji} Print "${match.topic}" on ${shortHash(input.principal)}`;
	const valuePreview = JSON.stringify(match.value).slice(0, 200);
	return {
		text,
		blocks: [
			{ type: "header", text: { type: "plain_text", text } },
			{
				type: "section",
				fields: [
					{
						type: "mrkdwn",
						text: `*Severity*\n${triage.severity.toUpperCase()}`,
					},
					{ type: "mrkdwn", text: `*Topic*\n\`${match.topic}\`` },
					{
						type: "mrkdwn",
						text: `*Contract*\n\`${shortHash(match.contractIdentifier)}\``,
					},
					{
						type: "mrkdwn",
						text: `*Block*\n${match.blockHeight}`,
					},
				],
			},
			{
				type: "section",
				text: {
					type: "mrkdwn",
					text: `*Summary*\n${triage.summary}`,
				},
			},
			{
				type: "section",
				text: {
					type: "mrkdwn",
					text: `*Value preview*\n\`\`\`${valuePreview}\`\`\``,
				},
			},
			{
				type: "context",
				elements: [
					{
						type: "mrkdwn",
						text: `Likely cause: _${triage.likelyCause}_ · Tx \`${shortHash(match.txId, 6)}\``,
					},
				],
			},
		],
	};
}

async function detect(input: PrintEventMatchInput): Promise<Match[]> {
	if (input.testMode) {
		return [
			{
				txId: `test-${Date.now().toString(16)}`,
				eventIndex: 0,
				blockHeight: 0,
				contractIdentifier: input.principal,
				topic: input.topic ?? "example-topic",
				value: { example: true },
			},
		];
	}

	const since = input.sinceIso
		? new Date(input.sinceIso)
		: new Date(Date.now() - INITIAL_LOOKBACK_MS);

	const topicFilter = input.topic
		? sql`AND (e.data->>'topic') = ${input.topic}`
		: sql``;

	const rows = await sql<{
		tx_id: string;
		event_index: number;
		block_height: number | bigint;
		contract_identifier: string;
		topic: string;
		value: unknown;
	}>`
		SELECT
			e.tx_id,
			e.event_index,
			e.block_height,
			(e.data->>'contract_identifier') AS contract_identifier,
			(e.data->>'topic') AS topic,
			(e.data->'value') AS value
		FROM events e
		WHERE e.type = 'smart_contract_event'
			AND (e.data->>'contract_identifier') = ${input.principal}
			${topicFilter}
			AND e.created_at > ${since}
		ORDER BY e.created_at ASC
		LIMIT 100
	`.execute(getSourceDb());

	return rows.rows.map((r) => ({
		txId: r.tx_id,
		eventIndex: r.event_index,
		blockHeight: Number(r.block_height),
		contractIdentifier: r.contract_identifier,
		topic: r.topic,
		value: r.value,
	}));
}

async function triage(
	input: PrintEventMatchInput,
	match: Match,
): Promise<Triage> {
	const valuePreview = JSON.stringify(match.value).slice(0, 500);
	const prompt = `You are a monitoring analyst for a Stacks smart contract.

Contract watched: ${input.principal}
${input.topic ? `Topic filter: ${input.topic}` : "No topic filter — all prints."}

Print event observed:
- Topic: ${match.topic}
- Value: ${valuePreview}
- Tx: ${match.txId}
- Block: ${match.blockHeight}

Print events are how Clarity contracts emit structured logs. Users set these sentries to catch specific lifecycle events (liquidations, pool drains, governance proposals, etc.).

Return:
- severity: "low" (routine), "med" (notable state change), "high" (critical — drain, exploit, emergency pause)
- summary: one sentence a human on-call engineer should see first
- likelyCause: one short phrase (e.g. "user liquidation", "governance vote", "emergency halt")`;

	try {
		const result = await generateObject({
			model: anthropic("claude-haiku-4-5-20251001"),
			schema: TriageSchema,
			prompt,
		});
		return result.object;
	} catch {
		return {
			severity: "med",
			summary: `Print event "${match.topic}" on ${input.principal}. AI triage unavailable.`,
			likelyCause: "unknown",
		};
	}
}

export const printEventMatchWorkflow = defineWorkflow({
	name: "sentry-print-event-match",
	input: PrintEventMatchInputSchema,
	run: async ({ input, step }) => {
		const matches = await step.run("detect", () => detect(input));

		const platformDb = getDb();
		let delivered = 0;
		let deduped = 0;

		for (const match of matches) {
			const key = idempotencyKey(match);
			const triageResult = await step.run(`triage:${key}`, () =>
				triage(input, match),
			);

			const inserted = input.testMode
				? { id: "test" }
				: await step.run(`persist:${key}`, async () => {
						const row = await insertAlert(platformDb, {
							sentry_id: input.sentryId,
							idempotency_key: key,
							payload: { match, triage: triageResult } as Record<
								string,
								unknown
							>,
						});
						return row ? { id: row.id } : null;
					});

			if (!inserted) {
				deduped += 1;
				continue;
			}

			const prefix = input.testMode ? "[TEST] " : "";
			const message = formatAlert(input, match, triageResult, prefix);
			const result = await step.run(`deliver:${key}`, () =>
				postToWebhook(input.deliveryWebhook, message),
			);

			if (!input.testMode && inserted.id !== "test") {
				await step.run(`record:${key}`, async () => {
					await updateAlertDelivery(
						platformDb,
						inserted.id,
						result.ok ? "delivered" : "failed",
						result.error,
					);
					return null;
				});
			}

			if (result.ok) delivered += 1;
		}

		if (!input.testMode) {
			await step.run("touch-last-check", async () => {
				await touchLastCheck(platformDb, input.sentryId, new Date());
				return null;
			});
		}

		return {
			matches: matches.length,
			delivered,
			deduped,
			testMode: !!input.testMode,
		};
	},
});
