import type { Database } from "@secondlayer/shared";
import { sql } from "kysely";
import type { Kysely } from "kysely";
import {
	getSessionSecret,
	mintSessionVoucher,
	verifySessionVoucher,
} from "./session.ts";

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
