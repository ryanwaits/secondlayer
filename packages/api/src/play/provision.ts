import { creditCredits } from "@secondlayer/platform/db/queries/account-credits";
import { PLAY_GRANT_USD_MICROS } from "@secondlayer/platform/hosted-meters";
import { getErrorMessage, logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import {
	deleteSubgraph,
	getSubgraph,
	listSubgraphs,
	updateSubgraphExpiry,
} from "@secondlayer/shared/db/queries/subgraphs";
import {
	createSubscription,
	getSubscriptionByName,
	notifySubscriptionsChanged,
} from "@secondlayer/shared/db/queries/subscriptions";
import {
	type DeploySubgraphRequest,
	DeploySubgraphRequestSchema,
} from "@secondlayer/shared/schemas/subgraphs";
import {
	CreateSubscriptionRequestSchema,
	type ParsedCreateSubscriptionRequest,
	type SubscriptionSchemaTables,
	formatSubscriptionSchemaErrors,
	validateSubscriptionFilterForTable,
} from "@secondlayer/shared/schemas/subscriptions";
import type { Context } from "hono";
import { sql } from "kysely";
import { getClientIp } from "../auth/http.ts";
import { hashToken } from "../auth/keys.ts";
import { mintApiKey } from "../auth/mint.ts";
import { bearerToken } from "../auth/read-plane.ts";
import { InvalidJSONError } from "../middleware/error.ts";
import { executeSubgraphDeploy } from "../routes/subgraphs.ts";
import {
	PLAY_MAX_CONCURRENT_PER_IP,
	countConcurrentPlaySubgraphs,
} from "./sybil.ts";
import { CLAIM_TOKEN_TTL_MS, createClaimToken } from "./tokens.ts";

export const PLAY_PROVISION_DAILY_LIMIT = 3;

function playClaimBaseUrl(): string {
	return process.env.WEB_URL ?? "https://secondlayer.tools";
}

function utcDay(now = new Date()): string {
	return now.toISOString().slice(0, 10);
}

function getDefinitionSchema(subgraph: {
	definition: Record<string, unknown>;
}): SubscriptionSchemaTables {
	const schema = subgraph.definition.schema;
	if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
		return {};
	}
	return schema as SubscriptionSchemaTables;
}

async function validateSubscriptionTarget(input: {
	accountId: string;
	subgraphName: string;
	tableName: string;
	filter?: unknown;
}): Promise<string[]> {
	const subgraph = await getSubgraph(
		getDb(),
		input.subgraphName,
		input.accountId,
	);
	if (!subgraph) {
		return [`Subgraph not found: ${input.subgraphName}`];
	}
	return validateSubscriptionFilterForTable({
		subgraphName: input.subgraphName,
		tableName: input.tableName,
		filter: input.filter,
		tables: getDefinitionSchema(subgraph),
	});
}

/** Insert-or-increment play_provisions. False when this IP is already at 3 today. */
export async function consumePlayProvisionSlot(
	db: ReturnType<typeof getDb>,
	ip: string,
	now = new Date(),
): Promise<boolean> {
	const ipHash = hashToken(ip);
	const day = utcDay(now);
	const result = await sql<{ count: number }>`
		INSERT INTO play_provisions (ip_hash, day, count)
		VALUES (${ipHash}, ${day}::date, 1)
		ON CONFLICT (ip_hash, day)
		DO UPDATE SET count = play_provisions.count + 1
		WHERE play_provisions.count < ${PLAY_PROVISION_DAILY_LIMIT}
		RETURNING count
	`.execute(db);
	return result.rows.length > 0;
}

async function rollbackPlay(
	db: ReturnType<typeof getDb>,
	ghostId: string,
	subgraphName: string | null,
): Promise<void> {
	if (subgraphName) {
		await deleteSubgraph(db, subgraphName, ghostId);
	}
	await db
		.deleteFrom("subscriptions")
		.where("account_id", "=", ghostId)
		.execute();
	await db.deleteFrom("accounts").where("id", "=", ghostId).execute();
}

export async function provisionPlay(c: Context): Promise<Response> {
	const body = await c.req.json().catch(() => {
		throw new InvalidJSONError();
	});
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		return c.json({ error: "Invalid body" }, 400);
	}

	const record = body as { subgraph?: unknown; subscription?: unknown };
	const subgraphParsed = DeploySubgraphRequestSchema.safeParse(record.subgraph);
	if (!subgraphParsed.success) {
		return c.json({ error: subgraphParsed.error.flatten().fieldErrors }, 400);
	}
	const subgraph: DeploySubgraphRequest = subgraphParsed.data;
	if (subgraph.dryRun) {
		return c.json({ error: "dryRun is not supported on /v1/play" }, 400);
	}

	let subscription: ParsedCreateSubscriptionRequest | undefined;
	if (record.subscription !== undefined) {
		const subParsed = CreateSubscriptionRequestSchema.safeParse(
			record.subscription,
		);
		if (!subParsed.success) {
			const details = formatSubscriptionSchemaErrors(subParsed.error);
			return c.json({ error: details.join("; "), details }, 400);
		}
		subscription = subParsed.data;
	}

	const db = getDb();
	const ip = getClientIp(c);
	if (ip === "unknown") {
		return c.json({ error: "ip_required", code: "PLAY_IP_UNKNOWN" }, 400);
	}
	const n = await countConcurrentPlaySubgraphs(db, ip);
	if (n >= PLAY_MAX_CONCURRENT_PER_IP) {
		return c.json(
			{
				error: "play_concurrency_limit",
				code: "PLAY_CONCURRENCY",
				limit: PLAY_MAX_CONCURRENT_PER_IP,
			},
			429,
		);
	}
	const allowed = await consumePlayProvisionSlot(db, ip);
	if (!allowed) {
		return c.json(
			{
				error: "Too many play provisions from this IP today",
				code: "RATE_LIMITED",
			},
			429,
		);
	}

	const ghost = await db
		.insertInto("accounts")
		.values({ email: null, ghost: true })
		.returningAll()
		.executeTakeFirstOrThrow();

	await creditCredits(db, ghost.id, PLAY_GRANT_USD_MICROS);

	const deployRes = await executeSubgraphDeploy(c, subgraph, {
		accountId: ghost.id,
	});
	if (!deployRes.ok) {
		await rollbackPlay(db, ghost.id, subgraph.name);
		return deployRes;
	}

	const expiresAt = new Date(Date.now() + CLAIM_TOKEN_TTL_MS);
	await updateSubgraphExpiry(db, subgraph.name, ghost.id, expiresAt);

	if (subscription) {
		try {
			const isChain = subscription.triggers !== undefined;
			if (!isChain) {
				const validationErrors = await validateSubscriptionTarget({
					accountId: ghost.id,
					subgraphName: subscription.subgraphName as string,
					tableName: subscription.tableName as string,
					filter: subscription.filter,
				});
				if (validationErrors.length > 0) {
					await rollbackPlay(db, ghost.id, subgraph.name);
					return c.json(
						{
							error: validationErrors.join("; "),
							details: validationErrors,
						},
						400,
					);
				}
			}
			const existing = await getSubscriptionByName(
				db,
				ghost.id,
				subscription.name,
			);
			if (existing) {
				await rollbackPlay(db, ghost.id, subgraph.name);
				return c.json(
					{ error: `Subscription "${subscription.name}" already exists` },
					400,
				);
			}
			await createSubscription(db, {
				accountId: ghost.id,
				name: subscription.name,
				kind: isChain ? "chain" : "subgraph",
				subgraphName: isChain ? null : subscription.subgraphName,
				tableName: isChain ? null : subscription.tableName,
				triggers: isChain ? subscription.triggers : undefined,
				url: subscription.url,
				format: subscription.format,
				runtime: subscription.runtime ?? null,
				filter: isChain ? {} : (subscription.filter ?? {}),
				authConfig: subscription.authConfig ?? {},
				maxRetries: subscription.maxRetries,
				timeoutMs: subscription.timeoutMs,
				concurrency: subscription.concurrency,
			});
			await notifySubscriptionsChanged(db, ghost.id);
		} catch (err) {
			logger.error("play subscription create failed", {
				error: getErrorMessage(err),
			});
			await rollbackPlay(db, ghost.id, subgraph.name);
			return c.json({ error: "Invalid subscription" }, 400);
		}
	}

	try {
		const minted = await mintApiKey(db, {
			accountId: ghost.id,
			name: "play",
			product: "account",
			ip,
		});
		const claim = await createClaimToken(db, ghost.id);
		return c.json(
			{
				key: minted.key,
				claim_url: `${playClaimBaseUrl()}/claim/${claim.raw}`,
				claim_expires_at: claim.expiresAt.toISOString(),
				subgraph: {
					name: subgraph.name,
					expires_at: expiresAt.toISOString(),
				},
			},
			201,
		);
	} catch (err) {
		logger.error("play mint or claim token failed", {
			error: getErrorMessage(err),
		});
		await rollbackPlay(db, ghost.id, subgraph.name);
		return c.json({ error: "Provision failed" }, 500);
	}
}

export async function getPlay(c: Context): Promise<Response> {
	const raw = bearerToken(c);
	if (!raw || !raw.startsWith("sk-sl_")) {
		return c.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
	}

	const db = getDb();
	const key = await db
		.selectFrom("api_keys")
		.select(["account_id", "status"])
		.where("key_hash", "=", hashToken(raw))
		.executeTakeFirst();
	if (!key || key.status !== "active") {
		return c.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
	}

	const account = await db
		.selectFrom("accounts")
		.select(["id", "ghost"])
		.where("id", "=", key.account_id)
		.executeTakeFirst();
	if (!account?.ghost) {
		return c.json({ error: "Not Found", code: "NOT_FOUND" }, 404);
	}

	const subgraphs = await listSubgraphs(db, account.id);
	const token = await db
		.selectFrom("claim_tokens")
		.select("expires_at")
		.where("account_id", "=", account.id)
		.where("used_at", "is", null)
		.orderBy("created_at", "desc")
		.executeTakeFirst();

	return c.json({
		subgraphs: subgraphs.map((s) => ({
			name: s.name,
			expires_at: s.expires_at ? new Date(s.expires_at).toISOString() : null,
		})),
		claim_expires_at: token?.expires_at
			? new Date(token.expires_at).toISOString()
			: null,
	});
}
