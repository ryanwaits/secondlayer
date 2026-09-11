import { getErrorMessage, logger } from "@secondlayer/shared";
import { type Database, getDb } from "@secondlayer/shared/db";
import type { Kysely } from "kysely";
import {
	debitCredits,
	recordCreditsSpend,
} from "./db/queries/account-credits.ts";

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
): Promise<void> {
	try {
		await debitHostedMeter(getDb(), accountId, indexingCost(blocks));
	} catch (err) {
		logger.warn("hosted indexing meter failed", {
			error: getErrorMessage(err),
		});
	}
}

export async function onDeliveryAttempt(accountId: string): Promise<void> {
	try {
		await debitHostedMeter(getDb(), accountId, deliveryCost(1));
	} catch (err) {
		logger.warn("hosted delivery meter failed", {
			error: getErrorMessage(err),
		});
	}
}
