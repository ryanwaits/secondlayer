import type { Database } from "@secondlayer/shared/db";
import { type Kysely, sql } from "kysely";
import {
	creditCredits,
	debitCredits,
	getCredits,
	getMonthlyCreditsSpend,
	recordCreditsSpend,
} from "../db/queries/account-credits.ts";
import { getCaps } from "../db/queries/account-spend-caps.ts";
import {
	SENTINEL_UNIT_PREFIX,
	claimLedgerEntry,
	markLedgerEntryDebited,
	monthlyQuantity,
	owedSentinelUsdMicros,
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
	/** Raw sampled quantity before any floor (`memory.gb_hour`'s actual RAM,
	 *  before the 0.5 GB minimum). Every other unit omits this — pricing
	 *  always uses `quantity`, never this. */
	observedQuantity?: number;
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
		// Hosted-stack units are fractional (GB-hours, GB-days); price in
		// floating point and round to the nearest µ$. Prices are ≤ 150k µ$, so
		// the product stays well inside Number's exact-integer range.
		return {
			usdMicros: BigInt(
				Math.round(Number(PRICES[input.unit]) * input.quantity),
			),
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
			observedQuantity: input.observedQuantity ?? null,
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
			observedQuantity: null,
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

export type GrantInput = {
	accountId: string;
	/** The positive amount credited, in USD-micros. */
	usdMicros: bigint;
	/** Free-text origin, e.g. `sentinel:starter`. */
	source: string;
	/** Unique per grant. A retried call with the same key credits once. */
	idempotencyKey: string;
	occurredAt?: Date;
};

/**
 * Credit a promotional grant (e.g. a starter credit): `creditCredits` + a
 * `unit: "grant"` ledger row, same transaction. Modelled on `recordTopup`,
 * idempotent on `idempotencyKey`: a second call with the same key returns
 * `granted: false` and never credits again. Callers own the amount policy
 * (who may grant, how much); this only moves the money.
 */
export async function grantCredits(
	db: Kysely<Database>,
	input: GrantInput,
): Promise<{ granted: boolean; balance: bigint }> {
	const occurredAt = input.occurredAt ?? new Date();
	return withTransaction(db, async (trx) => {
		const { claimed } = await claimLedgerEntry(trx, {
			accountId: input.accountId,
			unit: "grant",
			quantity: Number(input.usdMicros / 1_000_000n),
			observedQuantity: null,
			usdMicros: -input.usdMicros,
			debited: true,
			source: input.source,
			idempotencyKey: input.idempotencyKey,
			occurredAt,
		});
		if (!claimed) {
			return {
				granted: false,
				balance: await getCredits(trx, input.accountId),
			};
		}
		const balance = await creditCredits(trx, input.accountId, input.usdMicros);
		return { granted: true, balance };
	});
}

class BalanceShort extends Error {}

/**
 * Collect Sentinel usage that was recorded while the balance was short
 * (`debited=false`), oldest first, while the balance covers each row. Per row,
 * one transaction: claim it (`debited=false` -> true, only for a `sentinel.*`
 * unit; the row lock makes a concurrent settle wait, then find it already
 * settled), then a conditional debit. If the balance can't cover the row the
 * transaction rolls back, so the row stays owed. Other units are never touched.
 * Spend is counted toward the monthly cap exactly like `meter()` does.
 */
export async function settleOwedSentinel(
	db: Kysely<Database>,
	accountId: string,
): Promise<{
	settledUsdMicros: bigint;
	owedUsdMicros: bigint;
	balanceUsdMicros: bigint;
}> {
	const owedRows = await db
		.selectFrom("usage_ledger")
		.select(["id", "occurred_at"])
		.where("account_id", "=", accountId)
		.where("debited", "=", false)
		.where(sql<boolean>`unit LIKE ${`${SENTINEL_UNIT_PREFIX}%`}`)
		.orderBy("occurred_at", "asc")
		.orderBy("id", "asc")
		.execute();

	let settled = 0n;
	for (const owed of owedRows) {
		const paid = await withTransaction(db, async (trx) => {
			const claimed = await trx
				.updateTable("usage_ledger")
				.set({ debited: true })
				.where("id", "=", owed.id)
				.where("account_id", "=", accountId)
				.where("debited", "=", false)
				.where(sql<boolean>`unit LIKE ${`${SENTINEL_UNIT_PREFIX}%`}`)
				.returning("usd_micros")
				.executeTakeFirst();
			if (!claimed) return 0n; // settled by someone else meanwhile
			const usdMicros = BigInt(claimed.usd_micros);
			if (usdMicros > 0n) {
				const result = await debitCredits(trx, accountId, usdMicros);
				if (!result.ok) throw new BalanceShort(); // rolls the claim back
				await recordCreditsSpend(trx, accountId, usdMicros);
			}
			return usdMicros;
		}).catch((err) => {
			if (err instanceof BalanceShort) return null;
			throw err;
		});
		if (paid === null) break; // balance can't cover the oldest owed row
		settled += paid;
	}

	return {
		settledUsdMicros: settled,
		owedUsdMicros: await owedSentinelUsdMicros(db, accountId),
		balanceUsdMicros: await getCredits(db, accountId),
	};
}
