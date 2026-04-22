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
 * FT-outflow sentry — alert on fungible-token transfers above a
 * threshold involving a watched principal. SIP-010 parallel to
 * `large-outflow`. Scoped by `asset_identifier` so users can watch a
 * single token on a multi-token treasury without noise.
 */

export interface FtOutflowInput {
	sentryId: string;
	principal: string;
	/** Full SIP-010 asset identifier, e.g. `SP...CONTRACT.token-name::token` */
	assetIdentifier: string;
	/** Decimal string — the token's raw (pre-decimals) amount. */
	thresholdAmount: string;
	deliveryWebhook: string;
	sinceIso: string | null;
	testMode?: boolean;
}

export const FtOutflowInputSchema: z.ZodType<FtOutflowInput> = z.object({
	sentryId: z.string().uuid(),
	principal: z.string().min(28),
	assetIdentifier: z.string().min(3),
	thresholdAmount: z.string().regex(/^\d+$/),
	deliveryWebhook: z.string().url(),
	sinceIso: z.string().nullable(),
	testMode: z.boolean().optional(),
});

interface Match {
	txId: string;
	eventIndex: number;
	blockHeight: number;
	sender: string;
	recipient: string;
	amount: string;
	assetIdentifier: string;
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

function tokenSymbolFromAsset(assetId: string): string {
	// `SP....contract.name::token-symbol` → `token-symbol` (fallback to full)
	const parts = assetId.split("::");
	return parts[1] ?? assetId;
}

function formatAlert(
	input: FtOutflowInput,
	match: Match,
	triage: Triage,
	prefix: string,
): SlackMessage {
	const direction = match.sender === input.principal ? "outbound" : "inbound";
	const emoji =
		triage.severity === "high" ? "🚨" : triage.severity === "med" ? "⚠️" : "💸";
	const symbol = tokenSymbolFromAsset(match.assetIdentifier);
	const text = `${prefix}${emoji} Large ${direction} ${symbol} transfer on ${shortHash(input.principal)} — ${match.amount}`;
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
					{ type: "mrkdwn", text: `*Amount*\n${match.amount} ${symbol}` },
					{ type: "mrkdwn", text: `*From*\n\`${shortHash(match.sender)}\`` },
					{ type: "mrkdwn", text: `*To*\n\`${shortHash(match.recipient)}\`` },
				],
			},
			{
				type: "section",
				text: { type: "mrkdwn", text: `*Summary*\n${triage.summary}` },
			},
			{
				type: "context",
				elements: [
					{
						type: "mrkdwn",
						text: `Likely cause: _${triage.likelyCause}_ · Block ${match.blockHeight} · Tx \`${shortHash(match.txId, 6)}\``,
					},
				],
			},
		],
	};
}

async function detect(input: FtOutflowInput): Promise<Match[]> {
	if (input.testMode) {
		const bumped = (BigInt(input.thresholdAmount) + 1n).toString();
		return [
			{
				txId: `test-${Date.now().toString(16)}`,
				eventIndex: 0,
				blockHeight: 0,
				sender: input.principal,
				recipient: "SP000000000000000000002Q6VF78",
				amount: bumped,
				assetIdentifier: input.assetIdentifier,
			},
		];
	}

	const since = input.sinceIso
		? new Date(input.sinceIso)
		: new Date(Date.now() - INITIAL_LOOKBACK_MS);

	const rows = await sql<{
		tx_id: string;
		event_index: number;
		block_height: number | bigint;
		sender: string;
		recipient: string;
		amount: string;
		asset_identifier: string;
	}>`
		SELECT
			e.tx_id,
			e.event_index,
			e.block_height,
			(e.data->>'sender') AS sender,
			(e.data->>'recipient') AS recipient,
			(e.data->>'amount') AS amount,
			(e.data->>'asset_identifier') AS asset_identifier
		FROM events e
		WHERE e.type = 'ft_transfer_event'
			AND (e.data->>'asset_identifier') = ${input.assetIdentifier}
			AND ((e.data->>'sender') = ${input.principal}
				OR (e.data->>'recipient') = ${input.principal})
			AND (e.data->>'amount')::numeric > ${input.thresholdAmount}::numeric
			AND e.created_at > ${since}
		ORDER BY e.created_at ASC
		LIMIT 100
	`.execute(getSourceDb());

	return rows.rows.map((r) => ({
		txId: r.tx_id,
		eventIndex: r.event_index,
		blockHeight: Number(r.block_height),
		sender: r.sender,
		recipient: r.recipient,
		amount: r.amount,
		assetIdentifier: r.asset_identifier,
	}));
}

async function triage(input: FtOutflowInput, match: Match): Promise<Triage> {
	const direction = match.sender === input.principal ? "outbound" : "inbound";
	const symbol = tokenSymbolFromAsset(match.assetIdentifier);
	const prompt = `You are a monitoring analyst for a Stacks DeFi protocol.

Principal watched: ${input.principal}
Token: ${match.assetIdentifier}
Threshold: ${input.thresholdAmount} ${symbol}

Transfer observed (direction: ${direction}):
- Amount: ${match.amount} ${symbol}
- From: ${match.sender}
- To: ${match.recipient}
- Tx: ${match.txId}
- Block: ${match.blockHeight}

Assess this transfer. Return:
- severity: "low" (routine), "med" (unusual size or counterparty), "high" (immediate attention — very large, suspicious pattern, possible drain)
- summary: one sentence a human on-call engineer should see first
- likelyCause: one short phrase (e.g. "liquidity move", "user redemption", "possible exploit")`;

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
			summary: `Large ${direction} ${symbol} transfer (${match.amount}) on ${input.principal}. AI triage unavailable.`,
			likelyCause: "unknown",
		};
	}
}

export const ftOutflowWorkflow = defineWorkflow({
	name: "sentry-ft-outflow",
	input: FtOutflowInputSchema,
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
