import { getErrorMessage, logger } from "@secondlayer/shared";
import { type Database, getDb } from "@secondlayer/shared/db";
import {
	pauseSubgraph,
	resumePausedSubgraphs,
} from "@secondlayer/shared/db/queries/subgraphs";
import { toggleSubscriptionStatus } from "@secondlayer/shared/db/queries/subscriptions";
import type { Kysely } from "kysely";
import {
	debitCredits,
	recordCreditsSpend,
} from "./db/queries/account-credits.ts";

/** $10 play grant, credited once at ghost provision. */
export const PLAY_GRANT_USD_MICROS = 10_000_000n;

/** $1 / 1M blocks. */
export const INDEXING_USD_MICROS_PER_BLOCK = 1n;
/** $100 / 1M attempts. */
export const DELIVERY_USD_MICROS_PER_ATTEMPT = 100n;
/** $3 / subgraph-month, billed as $0.10/day on a 30-day month. */
export const RUNNING_USD_MICROS_PER_DAY = 100_000n;
/** $0.50 / GB-month. */
export const STORAGE_USD_MICROS_PER_GB_MONTH = 500_000n;

const BYTES_PER_GB = 1_000_000_000n;
const DAYS_PER_MONTH = 30n;

export function indexingCost(blocks: number): bigint {
	if (blocks <= 0) return 0n;
	return BigInt(blocks) * INDEXING_USD_MICROS_PER_BLOCK;
}

export function deliveryCost(attempts: number): bigint {
	if (attempts <= 0) return 0n;
	return BigInt(attempts) * DELIVERY_USD_MICROS_PER_ATTEMPT;
}

export function storageDailyCost(bytes: bigint): bigint {
	if (bytes <= 0n) return 0n;
	return (
		(bytes * STORAGE_USD_MICROS_PER_GB_MONTH) / (BYTES_PER_GB * DAYS_PER_MONTH)
	);
}

/**
 * Debit prepaid credits for a hosted meter. Returns false on empty account,
 * zero cost, or insufficient funds. Never throws on insufficient funds.
 */
export async function debitHostedMeter(
	db: Kysely<Database>,
	accountId: string,
	usdMicros: bigint,
): Promise<boolean> {
	if (!accountId || usdMicros <= 0n) return false;
	return await db.transaction().execute(async (trx) => {
		const res = await debitCredits(trx, accountId, usdMicros);
		if (res.ok) await recordCreditsSpend(trx, accountId, usdMicros);
		return res.ok;
	});
}

export async function onBlocksProcessed(
	accountId: string,
	blocks: number,
	subgraphName: string,
): Promise<boolean> {
	try {
		const cost = indexingCost(blocks);
		if (cost <= 0n) return true;
		const db = getDb();
		const ok = await debitHostedMeter(db, accountId, cost);
		if (!ok) await pauseSubgraph(db, subgraphName, accountId);
		return ok;
	} catch (err) {
		logger.warn("hosted indexing meter failed", {
			error: getErrorMessage(err),
		});
		return true;
	}
}

export async function onDeliveryAttempt(
	accountId: string,
	subscriptionId: string,
): Promise<boolean> {
	try {
		const cost = deliveryCost(1);
		if (cost <= 0n) return true;
		const db = getDb();
		const ok = await debitHostedMeter(db, accountId, cost);
		if (!ok) {
			await toggleSubscriptionStatus(db, accountId, subscriptionId, "paused");
		}
		return ok;
	} catch (err) {
		logger.warn("hosted delivery meter failed", {
			error: getErrorMessage(err),
		});
		return true;
	}
}

/** Unpause subgraphs and subscriptions after a successful creditCredits. */
export async function resumeHostedResources(
	db: Kysely<Database>,
	accountId: string,
): Promise<void> {
	await resumePausedSubgraphs(db, accountId);
	await db
		.updateTable("subscriptions")
		.set({
			status: "active",
			circuit_failures: 0,
			circuit_opened_at: null,
			updated_at: new Date(),
		})
		.where("account_id", "=", accountId)
		.where("status", "=", "paused")
		.execute();
}
