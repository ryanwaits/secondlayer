import type { Database } from "@secondlayer/shared/db";
import type { Kysely } from "kysely";
import {
	creditCredits,
	debitCredits,
	getCredits,
	getMonthlyCreditsSpend,
	recordCreditsSpend,
} from "../db/queries/account-credits.ts";
import { getCaps } from "../db/queries/account-spend-caps.ts";
import {
	claimLedgerEntry,
	markLedgerEntryDebited,
	monthlyQuantity,
} from "../db/queries/usage-ledger.ts";
import {
	COMMIT_TIER_MONTHLY_USD_MICROS,
	CREDIT_USD_MICROS_PER_ROW_VOLUME,
	type MeterUnit,
	PRICES,
	ROWS_DELIVERED_MONTHLY_ALLOWANCE,
	isOverMonthlyCreditCap,
} from "./prices.ts";

/**
 * The one function every billable path calls. One transaction: claim the
 * idempotency key, price the unit (allowance + volume tier for
 * `rows.delivered`; a flat `PRICES[unit] * quantity` for everything else),
 * debit `account_credits`, and write the ledger row. A short balance (or a
 * tripped spend cap) does not throw — the row is written with
 * `debited: false` so the gap is visible, never silently served free.
 *
 * `db` may be a plain `Kysely<Database>` or an existing `Transaction<Database>`
 * (Postgres SAVEPOINT) — the archive fetch gate calls `meter()` once per
 * priced partition inside its own aggregate-charge transaction.
 */
export type MeterInput = {
	accountId: string;
	unit: MeterUnit;
	/** Count of units consumed (rows, partitions, GB-hours, events). */
	quantity: number;
	/** Free-text origin for the usage view / audit trail, e.g. "index",
	 *  "streams", "archive", "internal:provisioner". */
	source: string;
	/** Unique per real-world event. A retried submission with the same key
	 *  is a no-op, not a second charge. */
	idempotencyKey: string;
	occurredAt?: Date;
};

export type MeterResult = {
	ledgerId: string;
	usdMicros: bigint;
	debited: boolean;
	balanceAfter: bigint;
	/** True when the entire charge was covered by the monthly free
	 *  allowance (`rows.delivered` only; always false for other units). */
	viaAllowance: boolean;
};

async function priceUnit(
	trx: Kysely<Database>,
	input: MeterInput,
	occurredAt: Date,
): Promise<{ usdMicros: bigint; viaAllowance: boolean }> {
	if (input.unit !== "rows.delivered") {
		return {
			usdMicros: PRICES[input.unit] * BigInt(input.quantity),
			viaAllowance: false,
		};
	}
	if (input.quantity <= 0) return { usdMicros: 0n, viaAllowance: false };

	const usedThisMonth = await monthlyQuantity(
		trx,
		input.accountId,
		input.unit,
		occurredAt,
	);
	const freeRemaining = Math.max(
		0,
		ROWS_DELIVERED_MONTHLY_ALLOWANCE - usedThisMonth,
	);
	const billableQty = Math.max(0, input.quantity - freeRemaining);
	if (billableQty === 0) return { usdMicros: 0n, viaAllowance: true };

	// Rate is decided by spend so far THIS call, not split within the batch —
	// same behavior as the pre-`meter()` `debitCreditedRows` (a page prices at
	// one flat rate; the next page sees the updated monthly total).
	const monthlySpend = await getMonthlyCreditsSpend(
		trx,
		input.accountId,
		occurredAt,
	);
	const rate =
		monthlySpend >= COMMIT_TIER_MONTHLY_USD_MICROS
			? CREDIT_USD_MICROS_PER_ROW_VOLUME
			: PRICES["rows.delivered"];
	return { usdMicros: BigInt(billableQty) * rate, viaAllowance: false };
}

/**
 * Run `fn` inside a transaction, unless `db` already IS one — Kysely's
 * `Transaction` has no `.transaction()` of its own (no nested transactions /
 * savepoints), so a caller that hands `meter()` its own open transaction
 * (the archive fetch gate, one `meter()` call per priced partition) gets its
 * queries run directly against it instead.
 */
function withTransaction<T>(
	db: Kysely<Database>,
	fn: (trx: Kysely<Database>) => Promise<T>,
): Promise<T> {
	return db.isTransaction ? fn(db) : db.transaction().execute(fn);
}

export async function meter(
	db: Kysely<Database>,
	input: MeterInput,
): Promise<MeterResult> {
	const occurredAt = input.occurredAt ?? new Date();

	return withTransaction(db, async (trx) => {
		const priced = await priceUnit(trx, input, occurredAt);

		const { row, claimed } = await claimLedgerEntry(trx, {
			accountId: input.accountId,
			unit: input.unit,
			quantity: input.quantity,
			usdMicros: priced.usdMicros,
			debited: true,
			source: input.source,
			idempotencyKey: input.idempotencyKey,
			occurredAt,
		});

		if (!claimed) {
			// Replay: the original charge already happened (or didn't). Never
			// debit again — return exactly what was recorded the first time.
			const balanceAfter = await getCredits(trx, input.accountId);
			return {
				ledgerId: row.id,
				usdMicros: BigInt(row.usd_micros),
				debited: row.debited,
				balanceAfter,
				viaAllowance: row.usd_micros === "0" || Number(row.usd_micros) === 0,
			};
		}

		let debited = true;
		if (priced.usdMicros > 0n) {
			if (input.unit === "rows.delivered") {
				const caps = await getCaps(trx, input.accountId);
				const spent = await getMonthlyCreditsSpend(
					trx,
					input.accountId,
					occurredAt,
				);
				if (
					caps?.monthly_cap_cents != null &&
					isOverMonthlyCreditCap(spent, caps.monthly_cap_cents)
				) {
					debited = false;
				}
			}
			if (debited) {
				const result = await debitCredits(
					trx,
					input.accountId,
					priced.usdMicros,
				);
				if (!result.ok) {
					debited = false;
				} else {
					await recordCreditsSpend(
						trx,
						input.accountId,
						priced.usdMicros,
						occurredAt,
					);
				}
			}
			if (!debited) await markLedgerEntryDebited(trx, row.id, false);
		}

		const balanceAfter = await getCredits(trx, input.accountId);
		return {
			ledgerId: row.id,
			usdMicros: priced.usdMicros,
			debited,
			balanceAfter,
			viaAllowance: priced.viaAllowance,
		};
	});
}

export type TopupInput = {
	accountId: string;
	/** The positive amount credited, in USD-micros. Stored in the ledger as a
	 *  negative `usd_micros` (money flowing IN, not a charge). */
	usdMicros: bigint;
	source: string;
	idempotencyKey: string;
	occurredAt?: Date;
};

/**
 * Record a Stripe top-up: `creditCredits` + a `unit: "topup"` ledger row,
 * same transaction. Idempotent on `idempotencyKey` (the caller passes the
 * Stripe event id) — a Stripe redelivery of an already-processed event never
 * reaches here (`processed_stripe_events` catches it first), but the ledger
 * claim is a second, independent guard against crediting twice.
 */
export async function recordTopup(
	db: Kysely<Database>,
	input: TopupInput,
): Promise<{ balance: bigint }> {
	const occurredAt = input.occurredAt ?? new Date();
	return withTransaction(db, async (trx) => {
		const { claimed } = await claimLedgerEntry(trx, {
			accountId: input.accountId,
			unit: "topup",
			quantity: Number(input.usdMicros / 1_000_000n),
			usdMicros: -input.usdMicros,
			debited: true,
			source: input.source,
			idempotencyKey: input.idempotencyKey,
			occurredAt,
		});
		if (!claimed) {
			return { balance: await getCredits(trx, input.accountId) };
		}
		const balance = await creditCredits(trx, input.accountId, input.usdMicros);
		return { balance };
	});
}
