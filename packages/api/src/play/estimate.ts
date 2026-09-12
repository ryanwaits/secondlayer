import { getCredits } from "@secondlayer/platform/db/queries/account-credits";
import {
	INDEXING_USD_MICROS_PER_BLOCK,
	PLAY_GRANT_USD_MICROS,
	RUNNING_USD_MICROS_PER_DAY,
	deliveryCost,
	storageDailyCost,
} from "@secondlayer/platform/hosted-meters";
import type { Database } from "@secondlayer/shared/db";
import { getDb } from "@secondlayer/shared/db";
import {
	listSubgraphs,
	pgSchemaName,
} from "@secondlayer/shared/db/queries/subgraphs";
import type { Context } from "hono";
import { type Kysely, sql } from "kysely";
import { hashToken } from "../auth/keys.ts";
import { STREAMS_BLOCKS_PER_DAY } from "../streams/tiers.ts";
import { findUnusedClaimToken } from "./tokens.ts";

export type EstimateLine = {
	meter: string;
	usd_micros: bigint;
	one_shot: boolean;
};

export type PlayEstimate = {
	grant_remaining_usd_micros: bigint;
	grant_spent_usd_micros: bigint;
	projected_monthly_usd_micros: bigint;
	lines: EstimateLine[];
};

export function formatUsd(micros: bigint): string {
	return (Number(micros) / 1_000_000).toFixed(2);
}

export function buildPlayEstimate(input: {
	grantMicros: bigint;
	remainingMicros: bigint;
	subgraphStatus: string;
	storageBytes: bigint;
	liveBlocksPerDay: number;
	deliveriesLast24h: number;
}): PlayEstimate {
	const running =
		input.subgraphStatus === "active" || input.subgraphStatus === "reindexing"
			? RUNNING_USD_MICROS_PER_DAY * 30n
			: 0n;
	const storage = storageDailyCost(input.storageBytes) * 30n;
	const indexingLive =
		BigInt(input.liveBlocksPerDay) * INDEXING_USD_MICROS_PER_BLOCK * 30n;
	const deliveries = deliveryCost(input.deliveriesLast24h) * 30n;
	const spent = input.grantMicros - input.remainingMicros;
	const grantSpent = spent > 0n ? spent : 0n;

	const lines: EstimateLine[] = [
		{ meter: "running", usd_micros: running, one_shot: false },
		{ meter: "storage", usd_micros: storage, one_shot: false },
		{ meter: "indexing_live", usd_micros: indexingLive, one_shot: false },
		{ meter: "deliveries", usd_micros: deliveries, one_shot: false },
		{ meter: "grant_spent", usd_micros: grantSpent, one_shot: true },
	];

	let projected = 0n;
	for (const line of lines) {
		if (!line.one_shot) projected += line.usd_micros;
	}

	return {
		grant_remaining_usd_micros: input.remainingMicros,
		grant_spent_usd_micros: grantSpent,
		projected_monthly_usd_micros: projected,
		lines,
	};
}

/** Single-schema variant of the worker hosted-meters size query. */
async function schemaStorageBytes(
	db: Kysely<Database>,
	schema: string,
): Promise<bigint> {
	try {
		const result = await sql<{
			bytes: string | number | bigint | null;
		}>`
			SELECT SUM(pg_total_relation_size(c.oid))::bigint AS bytes
			FROM pg_class c
			JOIN pg_namespace n ON n.oid = c.relnamespace
			WHERE n.nspname = ${schema} AND c.relkind IN ('r','i','m','p')
		`.execute(db);
		return BigInt(result.rows[0]?.bytes ?? 0);
	} catch {
		return 0n;
	}
}

async function deliveriesLast24h(
	db: Kysely<Database>,
	accountId: string,
): Promise<number> {
	const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
	const row = await db
		.selectFrom("subscription_deliveries")
		.innerJoin(
			"subscriptions",
			"subscriptions.id",
			"subscription_deliveries.subscription_id",
		)
		.select((eb) => eb.fn.countAll<string>().as("n"))
		.where("subscriptions.account_id", "=", accountId)
		.where("subscription_deliveries.dispatched_at", ">", since)
		.executeTakeFirst();
	return Number(row?.n ?? 0);
}

export async function getPlayEstimate(c: Context): Promise<Response> {
	const raw = c.req.header("X-Claim-Token")?.trim() ?? "";
	if (!raw) {
		return c.json({ error: "Missing X-Claim-Token" }, 400);
	}

	const db = getDb();
	const token = await findUnusedClaimToken(db, hashToken(raw));
	if (!token) {
		return c.json({ error: "Invalid claim token" }, 400);
	}

	const account = await db
		.selectFrom("accounts")
		.select(["id", "ghost"])
		.where("id", "=", token.account_id)
		.executeTakeFirst();
	if (!account?.ghost) {
		return c.json({ error: "Not Found", code: "NOT_FOUND" }, 404);
	}

	const subgraphs = await listSubgraphs(db, account.id);
	const subgraph = subgraphs[0];
	const remaining = await getCredits(db, account.id);
	const schema = subgraph
		? (subgraph.schema_name ?? pgSchemaName(subgraph.name))
		: null;
	const storageBytes = schema ? await schemaStorageBytes(db, schema) : 0n;
	const estimate = buildPlayEstimate({
		grantMicros: PLAY_GRANT_USD_MICROS,
		remainingMicros: remaining,
		subgraphStatus: subgraph?.status ?? "",
		storageBytes,
		liveBlocksPerDay: STREAMS_BLOCKS_PER_DAY,
		deliveriesLast24h: await deliveriesLast24h(db, account.id),
	});

	return c.json({
		grant_remaining_usd: formatUsd(estimate.grant_remaining_usd_micros),
		grant_spent_usd: formatUsd(estimate.grant_spent_usd_micros),
		projected_monthly_usd: formatUsd(estimate.projected_monthly_usd_micros),
		lines: estimate.lines.map((line) => ({
			meter: line.meter,
			usd: formatUsd(line.usd_micros),
			one_shot: line.one_shot,
		})),
	});
}
