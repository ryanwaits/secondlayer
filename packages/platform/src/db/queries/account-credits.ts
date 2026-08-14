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

export type CreditRefill = {
	belowUsdMicros: bigint | null;
	packUsd: number | null;
	lastAt: Date | null;
};

export async function getCreditRefill(
	db: Kysely<Database>,
	accountId: string,
): Promise<CreditRefill> {
	const row = await db
		.selectFrom("account_credits")
		.select(["refill_below_usd_micros", "refill_pack_usd", "refill_last_at"])
		.where("account_id", "=", accountId)
		.executeTakeFirst();
	return {
		belowUsdMicros:
			row?.refill_below_usd_micros != null
				? BigInt(row.refill_below_usd_micros)
				: null,
		packUsd: row?.refill_pack_usd ?? null,
		lastAt: row?.refill_last_at ?? null,
	};
}

/** `belowUsdMicros: null` turns refill off. Ensures a row exists. */
export async function setCreditRefill(
	db: Kysely<Database>,
	accountId: string,
	patch: { belowUsdMicros: bigint | null; packUsd: number | null },
): Promise<CreditRefill> {
	const row = await db
		.insertInto("account_credits")
		.values({
			account_id: accountId,
			balance_usd_micros: "0",
			refill_below_usd_micros: patch.belowUsdMicros?.toString() ?? null,
			refill_pack_usd: patch.packUsd,
			updated_at: new Date(),
		})
		.onConflict((oc) =>
			oc.column("account_id").doUpdateSet({
				refill_below_usd_micros: patch.belowUsdMicros?.toString() ?? null,
				refill_pack_usd: patch.packUsd,
				updated_at: new Date(),
			}),
		)
		.returning(["refill_below_usd_micros", "refill_pack_usd", "refill_last_at"])
		.executeTakeFirstOrThrow();
	return {
		belowUsdMicros:
			row.refill_below_usd_micros != null
				? BigInt(row.refill_below_usd_micros)
				: null,
		packUsd: row.refill_pack_usd,
		lastAt: row.refill_last_at,
	};
}

export type DueRefill = {
	accountId: string;
	stripeCustomerId: string;
	balanceUsdMicros: bigint;
	belowUsdMicros: bigint;
	packUsd: number;
};

const REFILL_COOLDOWN_MS = 60 * 60 * 1000;

export async function listDueRefills(
	db: Kysely<Database>,
	now: Date = new Date(),
): Promise<DueRefill[]> {
	const cutoff = new Date(now.getTime() - REFILL_COOLDOWN_MS);
	const rows = await db
		.selectFrom("account_credits")
		.innerJoin("accounts", "accounts.id", "account_credits.account_id")
		.select([
			"accounts.id as account_id",
			"accounts.stripe_customer_id",
			"account_credits.balance_usd_micros",
			"account_credits.refill_below_usd_micros",
			"account_credits.refill_pack_usd",
		])
		.where("account_credits.refill_below_usd_micros", "is not", null)
		.where("account_credits.refill_pack_usd", "is not", null)
		.where("accounts.stripe_customer_id", "is not", null)
		.where((eb) =>
			eb.or([
				eb("account_credits.refill_last_at", "is", null),
				eb("account_credits.refill_last_at", "<", cutoff),
			]),
		)
		.where(
			sql<boolean>`account_credits.balance_usd_micros < account_credits.refill_below_usd_micros`,
		)
		.execute();

	return rows.flatMap((row) => {
		if (!row.stripe_customer_id || row.refill_pack_usd == null) return [];
		if (row.refill_below_usd_micros == null) return [];
		return [
			{
				accountId: row.account_id,
				stripeCustomerId: row.stripe_customer_id,
				balanceUsdMicros: BigInt(row.balance_usd_micros),
				belowUsdMicros: BigInt(row.refill_below_usd_micros),
				packUsd: Number(row.refill_pack_usd),
			},
		];
	});
}

export async function touchRefill(
	db: Kysely<Database>,
	accountId: string,
	now: Date = new Date(),
): Promise<void> {
	await db
		.updateTable("account_credits")
		.set({ refill_last_at: now, updated_at: now })
		.where("account_id", "=", accountId)
		.execute();
}
