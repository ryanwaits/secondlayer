import type { Database } from "@secondlayer/shared";
import { sql } from "kysely";
import type { Kysely } from "kysely";
import {
	getSessionSecret,
	mintSessionVoucher,
	verifySessionVoucher,
} from "./session.ts";

/** Monthly spend above this triggers the "Pro removes the meter" nudge. */
export const UPGRADE_HINT_THRESHOLD_USD = 25;

/**
 * Prepaid x402 credit.
 *
 * A confirmed-tier deposit credits `x402_balances`; per-call drawdowns debit
 * it atomically with the price guard inside the UPDATE (no read-then-write
 * race; the CHECK constraint is the backstop). The drawdown credential is a
 * long-lived HMAC voucher minted at deposit time (`surface: "balance"`,
 * reusing the session machinery) — bearer semantics, same threat model as an
 * API key, zero per-call signing latency.
 */

export const BALANCE_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MIN_DEPOSIT_USD = 0.25;
export const MAX_DEPOSIT_USD = 100;

export function usdToMicros(usd: number): bigint {
	return BigInt(Math.round(usd * 1_000_000));
}

export async function creditBalance(
	db: Kysely<Database>,
	principal: string,
	usdMicros: bigint,
): Promise<bigint> {
	const row = await db
		.insertInto("x402_balances")
		.values({
			principal,
			balance_usd_micros: usdMicros.toString(),
			updated_at: new Date(),
		})
		.onConflict((oc) =>
			oc.column("principal").doUpdateSet({
				balance_usd_micros: sql`x402_balances.balance_usd_micros + ${usdMicros.toString()}`,
				updated_at: new Date(),
			}),
		)
		.returning("balance_usd_micros")
		.executeTakeFirstOrThrow();
	return BigInt(row.balance_usd_micros);
}

/** Atomic debit: succeeds only when the balance covers the price. */
export async function debitBalance(
	db: Kysely<Database>,
	principal: string,
	usdMicros: bigint,
): Promise<{ ok: boolean; remaining: bigint | null }> {
	const row = await db
		.updateTable("x402_balances")
		.set({
			balance_usd_micros: sql`balance_usd_micros - ${usdMicros.toString()}`,
			updated_at: new Date(),
		})
		.where("principal", "=", principal)
		.where("balance_usd_micros", ">=", usdMicros.toString())
		.returning("balance_usd_micros")
		.executeTakeFirst();
	if (!row) return { ok: false, remaining: null };
	return { ok: true, remaining: BigInt(row.balance_usd_micros) };
}

export async function getBalance(
	db: Kysely<Database>,
	principal: string,
): Promise<bigint> {
	const row = await db
		.selectFrom("x402_balances")
		.select("balance_usd_micros")
		.where("principal", "=", principal)
		.executeTakeFirst();
	return row ? BigInt(row.balance_usd_micros) : 0n;
}

export function mintBalanceToken(
	principal: string,
	secret: string,
	now: number = Date.now(),
): string {
	return mintSessionVoucher(
		{
			v: 1,
			id: principal,
			surface: "balance",
			payer: principal,
			exp: now + BALANCE_TOKEN_TTL_MS,
		},
		secret,
	);
}

/** Verify a PAYMENT-BALANCE token → payer principal, or null. */
export function verifyBalanceToken(
	token: string,
	secret: string | undefined = getSessionSecret(),
): string | null {
	if (!secret) return null;
	const voucher = verifySessionVoucher(token, secret);
	if (!voucher || voucher.surface !== "balance") return null;
	return voucher.payer;
}

function monthKey(now: Date = new Date()): string {
	return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Record consumption (per-call settles and tab drawdowns) into the rolling
 * month bucket. Upserts the principal row so per-call payers without a tab
 * still accumulate a spend history (balance stays 0).
 */
export async function recordSpend(
	db: Kysely<Database>,
	principal: string,
	usdMicros: bigint,
	now: Date = new Date(),
): Promise<void> {
	const month = monthKey(now);
	await db
		.insertInto("x402_balances")
		.values({
			principal,
			balance_usd_micros: "0",
			spent_month: month,
			spent_month_usd_micros: usdMicros.toString(),
			updated_at: now,
		})
		.onConflict((oc) =>
			oc.column("principal").doUpdateSet({
				spent_month: month,
				spent_month_usd_micros: sql`CASE
					WHEN x402_balances.spent_month = ${month}
					THEN x402_balances.spent_month_usd_micros + ${usdMicros.toString()}
					ELSE ${usdMicros.toString()}
				END`,
				updated_at: now,
			}),
		)
		.execute();
}

export async function getMonthlySpend(
	db: Kysely<Database>,
	principal: string,
	now: Date = new Date(),
): Promise<bigint> {
	const row = await db
		.selectFrom("x402_balances")
		.select(["spent_month", "spent_month_usd_micros"])
		.where("principal", "=", principal)
		.executeTakeFirst();
	if (!row || row.spent_month !== monthKey(now)) return 0n;
	return BigInt(row.spent_month_usd_micros);
}

/** Funnel nudge for the response payloads — undefined under the threshold. */
export function upgradeHint(spentUsdMicros: bigint): string | undefined {
	const spentUsd = Number(spentUsdMicros) / 1_000_000;
	if (spentUsd < UPGRADE_HINT_THRESHOLD_USD) return undefined;
	return `You have spent $${spentUsd.toFixed(2)} via x402 this month — the Pro plan ($99/mo) removes the meter entirely.`;
}

/** Attach a wallet's historical on-chain payments to a claimed account. */
export async function linkWalletHistory(
	db: Kysely<Database>,
	principal: string,
	accountId: string,
): Promise<number> {
	const res = await db
		.updateTable("x402_payments")
		.set({ account_id: accountId })
		.where("payer", "=", principal)
		.where("account_id", "is", null)
		.executeTakeFirst();
	return Number(res.numUpdatedRows ?? 0n);
}
