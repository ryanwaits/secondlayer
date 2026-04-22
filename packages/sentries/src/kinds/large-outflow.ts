import { createHash } from "node:crypto";
import { anthropic } from "@ai-sdk/anthropic";
import {
	type LargeOutflowConfig,
	LargeOutflowConfigSchema,
} from "@secondlayer/shared/schemas/sentries";
import { generateObject } from "ai";
import { sql } from "kysely";
import { z } from "zod/v4";
import type { SentryKind, SlackMessage, Triage } from "../types.ts";

export interface LargeOutflowMatch {
	txId: string;
	eventIndex: number;
	blockHeight: number;
	createdAt: Date;
	sender: string;
	recipient: string;
	amountMicroStx: string;
}

const TriageSchema = z.object({
	severity: z.enum(["low", "med", "high"]),
	summary: z.string().min(1).max(400),
	likelyCause: z.string().min(1).max(200),
});

interface EventRow {
	tx_id: string;
	event_index: number;
	block_height: number | bigint;
	created_at: Date;
	sender: string;
	recipient: string;
	amount: string;
}

function shortHash(s: string, n = 8): string {
	return s.length <= n * 2 + 3 ? s : `${s.slice(0, n)}…${s.slice(-n)}`;
}

function formatStx(micro: string): string {
	const n = BigInt(micro);
	const stx = n / 1_000_000n;
	const remainder = n % 1_000_000n;
	if (remainder === 0n) return `${stx.toLocaleString("en-US")} STX`;
	const frac = remainder.toString().padStart(6, "0").replace(/0+$/, "");
	return `${stx.toLocaleString("en-US")}.${frac} STX`;
}

export const largeOutflowKind: SentryKind<
	LargeOutflowConfig,
	LargeOutflowMatch
> = {
	kind: "large-outflow",
	configSchema: LargeOutflowConfigSchema,

	async detect(ctx, config, since) {
		const rows = await sql<EventRow>`
			SELECT
				e.tx_id,
				e.event_index,
				e.block_height,
				e.created_at,
				(e.data->>'sender') AS sender,
				(e.data->>'recipient') AS recipient,
				(e.data->>'amount') AS amount
			FROM events e
			WHERE e.type = 'stx_transfer_event'
				AND ((e.data->>'sender') = ${config.principal}
					OR (e.data->>'recipient') = ${config.principal})
				AND (e.data->>'amount')::numeric > ${config.thresholdMicroStx}::numeric
				AND e.created_at > ${since}
			ORDER BY e.created_at ASC
			LIMIT 100
		`.execute(ctx.sourceDb);

		return rows.rows.map((r) => ({
			txId: r.tx_id,
			eventIndex: r.event_index,
			blockHeight: Number(r.block_height),
			createdAt:
				r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
			sender: r.sender,
			recipient: r.recipient,
			amountMicroStx: r.amount,
		}));
	},

	async triage(ctx, config, match): Promise<Triage> {
		const direction =
			match.sender === config.principal ? "outbound" : "inbound";
		const prompt = `You are a monitoring analyst for a Stacks blockchain protocol.

Principal watched: ${config.principal}
Threshold: ${formatStx(config.thresholdMicroStx)}

Transfer observed (direction: ${direction}):
- Amount: ${formatStx(match.amountMicroStx)} (${match.amountMicroStx} µSTX)
- From: ${match.sender}
- To: ${match.recipient}
- Tx: ${match.txId}
- Block: ${match.blockHeight}

Assess this transfer. Return:
- severity: "low" (routine, expected-size outflow/inflow), "med" (unusual size or counterparty), or "high" (immediate attention — very large, suspicious pattern, or unknown counterparty)
- summary: one sentence a human on-call engineer should see first
- likelyCause: one short phrase (e.g. "treasury withdrawal", "user redemption", "possible drain")`;

		try {
			const result = await generateObject({
				model: anthropic("claude-haiku-4-5-20251001"),
				schema: TriageSchema,
				prompt,
			});
			return result.object;
		} catch (err) {
			ctx.logger.warn("sentry.triage failed, using fallback", {
				error: err instanceof Error ? err.message : String(err),
				txId: match.txId,
			});
			return {
				severity: "med",
				summary: `Large ${direction} transfer of ${formatStx(match.amountMicroStx)} observed on ${config.principal}. AI triage unavailable.`,
				likelyCause: "unknown",
			};
		}
	},

	formatAlert(config, match, triage): SlackMessage {
		const direction =
			match.sender === config.principal ? "outbound" : "inbound";
		const emoji =
			triage.severity === "high"
				? "🚨"
				: triage.severity === "med"
					? "⚠️"
					: "🐋";
		const text = `${emoji} Large ${direction} transfer on ${shortHash(config.principal)} — ${formatStx(match.amountMicroStx)}`;
		return {
			text,
			blocks: [
				{
					type: "header",
					text: { type: "plain_text", text },
				},
				{
					type: "section",
					fields: [
						{
							type: "mrkdwn",
							text: `*Severity*\n${triage.severity.toUpperCase()}`,
						},
						{
							type: "mrkdwn",
							text: `*Amount*\n${formatStx(match.amountMicroStx)}`,
						},
						{
							type: "mrkdwn",
							text: `*From*\n\`${shortHash(match.sender)}\``,
						},
						{
							type: "mrkdwn",
							text: `*To*\n\`${shortHash(match.recipient)}\``,
						},
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
	},

	idempotencyKey(match): string {
		return createHash("sha256")
			.update(`${match.txId}:${match.eventIndex}`)
			.digest("hex");
	},

	buildTestMatch(config): LargeOutflowMatch {
		const thresholdPlus = (BigInt(config.thresholdMicroStx) + 1n).toString();
		return {
			txId: `test-${Date.now().toString(16)}`,
			eventIndex: 0,
			blockHeight: 0,
			createdAt: new Date(),
			sender: config.principal,
			recipient: "SP000000000000000000002Q6VF78",
			amountMicroStx: thresholdPlus,
		};
	},
};
