import type { Database } from "@secondlayer/shared/db";
import { sql } from "kysely";
import type { Kysely } from "kysely";

/**
 * Prepaid dev credits — the card-funded peer to the wallet-funded x402 rail
 * (`packages/api/src/x402/balance.ts`). Same atomic-debit mechanics, keyed by
 * `account_id`. A Stripe card top-up credits the balance; metered reads /
 * subgraph indexing debit it. The prepaid balance is the hard bill-shock
 * ceiling; `recordCreditsSpend` accumulates a rolling monthly counter for the
 * optional per-account cap (`account_spend_caps`).
 */

export function usdToMicros(usd: number): bigint {
	return BigInt(Math.round(usd * 1_000_000));
}

export async function creditCredits(
	db: Kysely<Database>,
	accountId: string,
	usdMicros: bigint,
): Promise<bigint> {
	const row = await db
		.insertInto("account_credits")
		.values({
			account_id: accountId,
			balance_usd_micros: usdMicros.toString(),
			updated_at: new Date(),
		})
		.onConflict((oc) =>
			oc.column("account_id").doUpdateSet({
				balance_usd_micros: sql`account_credits.balance_usd_micros + ${usdMicros.toString()}`,
				updated_at: new Date(),
			}),
		)
		.returning("balance_usd_micros")
		.executeTakeFirstOrThrow();
	return BigInt(row.balance_usd_micros);
}

/** Atomic debit: succeeds only when the balance covers the price. */
export async function debitCredits(
	db: Kysely<Database>,
	accountId: string,
	usdMicros: bigint,
): Promise<{ ok: boolean; remaining: bigint | null }> {
	const row = await db
		.updateTable("account_credits")
		.set({
			balance_usd_micros: sql`balance_usd_micros - ${usdMicros.toString()}`,
			updated_at: new Date(),
		})
		.where("account_id", "=", accountId)
		.where("balance_usd_micros", ">=", usdMicros.toString())
		.returning("balance_usd_micros")
		.executeTakeFirst();
	if (!row) return { ok: false, remaining: null };
	return { ok: true, remaining: BigInt(row.balance_usd_micros) };
}

export async function getCredits(
	db: Kysely<Database>,
	accountId: string,
): Promise<bigint> {
	const row = await db
		.selectFrom("account_credits")
		.select("balance_usd_micros")
		.where("account_id", "=", accountId)
		.executeTakeFirst();
	return row ? BigInt(row.balance_usd_micros) : 0n;
}

function monthKey(now: Date = new Date()): string {
	return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Accumulate consumption into the rolling month bucket (mirrors x402 recordSpend). */
export async function recordCreditsSpend(
	db: Kysely<Database>,
	accountId: string,
	usdMicros: bigint,
	now: Date = new Date(),
): Promise<void> {
	const month = monthKey(now);
	await db
		.insertInto("account_credits")
		.values({
			account_id: accountId,
			balance_usd_micros: "0",
			spent_month: month,
			spent_month_usd_micros: usdMicros.toString(),
			updated_at: now,
		})
		.onConflict((oc) =>
			oc.column("account_id").doUpdateSet({
				spent_month: month,
				spent_month_usd_micros: sql`CASE
					WHEN account_credits.spent_month = ${month}
					THEN account_credits.spent_month_usd_micros + ${usdMicros.toString()}
					ELSE ${usdMicros.toString()}
				END`,
				updated_at: now,
			}),
		)
		.execute();
}

export async function getMonthlyCreditsSpend(
	db: Kysely<Database>,
	accountId: string,
	now: Date = new Date(),
): Promise<bigint> {
	const row = await db
		.selectFrom("account_credits")
		.select(["spent_month", "spent_month_usd_micros"])
		.where("account_id", "=", accountId)
		.executeTakeFirst();
	if (!row || row.spent_month !== monthKey(now)) return 0n;
	return BigInt(row.spent_month_usd_micros);
}
