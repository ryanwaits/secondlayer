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
 * Permission-change sentry — alert on successful calls to any of a
 * configured set of admin functions on a watched contract. Typical
 * target list: `set-owner`, `set-admin`, `transfer-ownership`.
 *
 * Input is the sentry row plus `testMode` flag for the "Send test
 * alert" button (synthesizes a match without touching the indexer DB).
 */

export interface PermissionChangeInput {
	sentryId: string;
	/** Contract principal, e.g. `SP...CONTRACT.contract-name` */
	principal: string;
	adminFunctions: string[];
	deliveryWebhook: string;
	sinceIso: string | null;
	testMode?: boolean;
}

export const PermissionChangeInputSchema: z.ZodType<PermissionChangeInput> =
	z.object({
		sentryId: z.string().uuid(),
		principal: z.string().min(28),
		adminFunctions: z.array(z.string().min(1)).min(1),
		deliveryWebhook: z.string().url(),
		sinceIso: z.string().nullable(),
		testMode: z.boolean().optional(),
	});

interface Match {
	txId: string;
	blockHeight: number;
	sender: string;
	functionName: string;
	functionArgs: unknown;
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
	return createHash("sha256")
		.update(`${match.txId}:${match.functionName}`)
		.digest("hex");
}

function shortHash(s: string, n = 8): string {
	return s.length <= n * 2 + 3 ? s : `${s.slice(0, n)}…${s.slice(-n)}`;
}

function formatAlert(
	input: PermissionChangeInput,
	match: Match,
	triage: Triage,
	prefix: string,
): SlackMessage {
	const emoji =
		triage.severity === "high" ? "🚨" : triage.severity === "med" ? "⚠️" : "🔐";
	const text = `${prefix}${emoji} ${match.functionName} called on ${shortHash(input.principal)}`;
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
					{ type: "mrkdwn", text: `*Function*\n\`${match.functionName}\`` },
					{
						type: "mrkdwn",
						text: `*Caller*\n\`${shortHash(match.sender)}\``,
					},
					{
						type: "mrkdwn",
						text: `*Contract*\n\`${shortHash(input.principal)}\``,
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
}

async function detect(input: PermissionChangeInput): Promise<Match[]> {
	if (input.testMode) {
		return [
			{
				txId: `test-${Date.now().toString(16)}`,
				blockHeight: 0,
				sender: "SP000000000000000000002Q6VF78",
				functionName: input.adminFunctions[0] ?? "set-owner",
				functionArgs: null,
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
		function_name: string;
		function_args: unknown;
		created_at: Date;
	}>`
		SELECT tx_id, block_height, sender, function_name, function_args, created_at
		FROM transactions
		WHERE contract_id = ${input.principal}
			AND function_name = ANY(${input.adminFunctions}::text[])
			AND status = 'success'
			AND created_at > ${since}
		ORDER BY created_at ASC
		LIMIT 100
	`.execute(getSourceDb());

	return rows.rows.map((r) => ({
		txId: r.tx_id,
		blockHeight: Number(r.block_height),
		sender: r.sender,
		functionName: r.function_name,
		functionArgs: r.function_args,
		createdAt:
			r.created_at instanceof Date
				? r.created_at.toISOString()
				: String(r.created_at),
	}));
}

async function triage(
	input: PermissionChangeInput,
	match: Match,
): Promise<Triage> {
	const argsPreview =
		match.functionArgs == null
			? "(none)"
			: JSON.stringify(match.functionArgs).slice(0, 400);
	const prompt = `You are a monitoring analyst for a Stacks smart contract.

Contract watched: ${input.principal}
Admin functions tracked: ${input.adminFunctions.join(", ")}

Successful admin call observed:
- Function: ${match.functionName}
- Caller: ${match.sender}
- Tx: ${match.txId}
- Block: ${match.blockHeight}
- Args preview: ${argsPreview}

Assess this call. Return:
- severity: "low" (routine ops), "med" (role change or unusual caller), "high" (ownership transfer, unknown caller on privileged function, or possible takeover)
- summary: one sentence a human on-call engineer should see first
- likelyCause: one short phrase (e.g. "planned rotation", "ownership transfer", "possible compromise")`;

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
			summary: `Admin call \`${match.functionName}\` on ${input.principal} by ${shortHash(match.sender)}. AI triage unavailable.`,
			likelyCause: "unknown",
		};
	}
}

export const permissionChangeWorkflow = defineWorkflow({
	name: "sentry-permission-change",
	input: PermissionChangeInputSchema,
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
