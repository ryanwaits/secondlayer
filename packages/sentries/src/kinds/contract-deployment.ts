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
 * Contract-deployment sentry — alert when a watched principal deploys
 * a new smart contract (tx.type = 'smart_contract'). Typical target:
 * protocol admin / treasury addresses that shouldn't be deploying new
 * contracts unexpectedly (supply-chain / vault-drain vector).
 */

export interface ContractDeploymentInput {
	sentryId: string;
	/** Principal (address only — contract deployments use the sender). */
	principal: string;
	deliveryWebhook: string;
	sinceIso: string | null;
	testMode?: boolean;
}

export const ContractDeploymentInputSchema: z.ZodType<ContractDeploymentInput> =
	z.object({
		sentryId: z.string().uuid(),
		principal: z.string().min(28),
		deliveryWebhook: z.string().url(),
		sinceIso: z.string().nullable(),
		testMode: z.boolean().optional(),
	});

interface Match {
	txId: string;
	blockHeight: number;
	sender: string;
	contractId: string;
	createdAt: string;
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
	return createHash("sha256").update(match.txId).digest("hex");
}

function shortHash(s: string, n = 8): string {
	return s.length <= n * 2 + 3 ? s : `${s.slice(0, n)}…${s.slice(-n)}`;
}

function formatAlert(
	input: ContractDeploymentInput,
	match: Match,
	triage: Triage,
	prefix: string,
): SlackMessage {
	const emoji =
		triage.severity === "high" ? "🚨" : triage.severity === "med" ? "⚠️" : "📦";
	const text = `${prefix}${emoji} New contract deployed by ${shortHash(input.principal)} — ${match.contractId}`;
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
					{
						type: "mrkdwn",
						text: `*Contract*\n\`${match.contractId}\``,
					},
					{
						type: "mrkdwn",
						text: `*Deployer*\n\`${shortHash(match.sender)}\``,
					},
					{
						type: "mrkdwn",
						text: `*Block*\n${match.blockHeight}`,
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
						text: `Likely cause: _${triage.likelyCause}_ · Tx \`${shortHash(match.txId, 6)}\``,
					},
				],
			},
		],
	};
}

async function detect(input: ContractDeploymentInput): Promise<Match[]> {
	if (input.testMode) {
		return [
			{
				txId: `test-${Date.now().toString(16)}`,
				blockHeight: 0,
				sender: input.principal,
				contractId: `${input.principal}.example-contract`,
				createdAt: new Date().toISOString(),
			},
		];
	}

	const since = input.sinceIso
		? new Date(input.sinceIso)
		: new Date(Date.now() - INITIAL_LOOKBACK_MS);

	const rows = await sql<{
		tx_id: string;
		block_height: number | bigint;
		sender: string;
		contract_id: string | null;
		created_at: Date;
	}>`
		SELECT tx_id, block_height, sender, contract_id, created_at
		FROM transactions
		WHERE type = 'smart_contract'
			AND sender = ${input.principal}
			AND status = 'success'
			AND created_at > ${since}
		ORDER BY created_at ASC
		LIMIT 100
	`.execute(getSourceDb());

	return rows.rows
		.filter((r) => r.contract_id != null)
		.map((r) => ({
			txId: r.tx_id,
			blockHeight: Number(r.block_height),
			sender: r.sender,
			contractId: r.contract_id as string,
			createdAt:
				r.created_at instanceof Date
					? r.created_at.toISOString()
					: String(r.created_at),
		}));
}

async function triage(
	input: ContractDeploymentInput,
	match: Match,
): Promise<Triage> {
	const prompt = `You are a monitoring analyst for Stacks protocol operations.

Principal watched: ${input.principal}
A new smart contract was deployed by this principal:

- Contract: ${match.contractId}
- Deployer: ${match.sender}
- Tx: ${match.txId}
- Block: ${match.blockHeight}

Unexpected deployments from privileged principals (admin, treasury, protocol ops) can indicate supply-chain compromise, planned upgrades, or routine ops.

Return:
- severity: "low" (routine — matches known deploy pattern), "med" (unannounced but plausible), "high" (suspicious — principal shouldn't be deploying; possible compromise)
- summary: one sentence a human on-call engineer should see first
- likelyCause: one short phrase (e.g. "scheduled upgrade", "ops deploy", "possible compromise")`;

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
			summary: `New contract ${match.contractId} deployed by ${shortHash(input.principal)}. AI triage unavailable.`,
			likelyCause: "unknown",
		};
	}
}

export const contractDeploymentWorkflow = defineWorkflow({
	name: "sentry-contract-deployment",
	input: ContractDeploymentInputSchema,
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
