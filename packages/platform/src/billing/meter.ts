import type { Database } from "@secondlayer/shared/db";
import type { Kysely } from "kysely";
import {
	creditCredits,
	debitCredits,
	debitCreditsUpTo,
	getCredits,
	getMonthlyCreditsSpend,
	lockAccountCredits,
	recordCreditsSpend,
} from "../db/queries/account-credits.ts";
import { getCaps } from "../db/queries/account-spend-caps.ts";
import { isInternalAccount } from "../db/queries/accounts.ts";
import {
	claimLedgerEntry,
	monthlyQuantity,
	recordLedgerDebit,
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
 * tripped spend cap, which applies to every unit) does not throw — the row is
 * written with `debited: false` so the gap is visible, never silently served
 * free. Hosted-stack units (`CLAMPED_UNITS`) take what the balance has left
 * on a short charge, so the balance reaches 0 and the stack stops. An
 * internal account's usage is written at $0 and never debited.
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
	 *  before the stack's minimum). Every other unit omits this — pricing
	 *  always uses `quantity`, never this. */
	observedQuantity?: number;
	/** Free-text origin for the usage view / audit trail, e.g. "index",
	 *  "streams", "archive", "internal:provisioner". */
	source: string;
	/** Unique per real-world event. A retried submission with the same key
	 *  is a no-op, not a second charge. */
	idempotencyKey: string;
	occurredAt?: Date;
	/** The API key that made the request, for per-key usage; omit for
	 *  anything not caused by a keyed read. */
	apiKeyId?: string | null;
};

export type MeterResult = {
	ledgerId: string;
	usdMicros: bigint;
	debited: boolean;
	/** Amount actually taken from the balance (`0..usdMicros`); a clamped
	 *  stack charge can take part of its price. */
	debitedUsdMicros: bigint;
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
	const monthlySpend = await getMonthlyCreditsSpend(trx, input.accountId);
	const rate =
		monthlySpend >= COMMIT_TIER_MONTHLY_USD_MICROS
			? CREDIT_USD_MICROS_PER_ROW_VOLUME
			: PRICES["rows.delivered"];
	return { usdMicros: BigInt(billableQty) * rate, viaAllowance: false };
}

/** Hosted-stack units: a short balance is drained to 0 rather than refused
 *  (`debitCreditsUpTo`). Everything else is all-or-nothing. */
const CLAMPED_UNITS: ReadonlySet<MeterUnit> = new Set<MeterUnit>([
	"memory.gb_hour",
	"storage.gb_day",
	"webhook.event",
]);

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

/** The ledger's shape, asserted before anything is written (the DB CHECKs in
 *  migration 0196 are the second line): a known unit and a finite,
 *  non-negative quantity, so a charge can never be a credit. */
function assertChargeInput(input: MeterInput): void {
	if (!Object.prototype.hasOwnProperty.call(PRICES, input.unit)) {
		throw new Error(`meter: unknown unit ${String(input.unit)}`);
	}
	if (!Number.isFinite(input.quantity) || input.quantity < 0) {
		throw new Error(
			`meter: quantity must be a finite number >= 0, got ${input.quantity}`,
		);
	}
}

export async function meter(
	db: Kysely<Database>,
	input: MeterInput,
): Promise<MeterResult> {
	assertChargeInput(input);
	const occurredAt = input.occurredAt ?? new Date();

	return withTransaction(db, async (trx) => {
		// One charge at a time per account: pricing reads the month's usage and
		// spend, the debit reads the cap; concurrent charges must not interleave.
		await lockAccountCredits(trx, input.accountId);
		const priced = (await isInternalAccount(trx, input.accountId))
			? { usdMicros: 0n, viaAllowance: false }
			: await priceUnit(trx, input, occurredAt);
		if (priced.usdMicros < 0n) {
			throw new Error(`meter: negative price ${priced.usdMicros} µ$`);
		}

		const { row, claimed } = await claimLedgerEntry(trx, {
			accountId: input.accountId,
			unit: input.unit,
			quantity: input.quantity,
			observedQuantity: input.observedQuantity ?? null,
			usdMicros: priced.usdMicros,
			debitedUsdMicros: priced.usdMicros,
			source: input.source,
			idempotencyKey: input.idempotencyKey,
			occurredAt,
			apiKeyId: input.apiKeyId ?? null,
		});

		if (!claimed) {
			// Replay: the original charge already happened (or didn't). Never
			// debit again — return exactly what was recorded the first time.
			const balanceAfter = await getCredits(trx, input.accountId);
			return {
				ledgerId: row.id,
				usdMicros: BigInt(row.usd_micros),
				debited: row.debited,
				debitedUsdMicros: BigInt(row.debited_usd_micros),
				balanceAfter,
				viaAllowance: row.usd_micros === "0" || Number(row.usd_micros) === 0,
			};
		}

		let taken = priced.usdMicros;
		if (priced.usdMicros > 0n) {
			// The cap caps every unit: a charge past it is recorded, never taken.
			const caps = await getCaps(trx, input.accountId);
			// Spend is counted in the month the charge is taken, never the item's
			// own `occurredAt`: a late item from last month must not rewrite the
			// current month's counter.
			const spent = await getMonthlyCreditsSpend(trx, input.accountId);
			if (
				caps?.monthly_cap_cents != null &&
				isOverMonthlyCreditCap(spent, caps.monthly_cap_cents)
			) {
				taken = 0n;
			} else {
				if (CLAMPED_UNITS.has(input.unit)) {
					// Stack units drain a short balance to 0 (so the poll stops the
					// stack) and record the row as owed; the shortfall is written off.
					const result = await debitCreditsUpTo(
						trx,
						input.accountId,
						priced.usdMicros,
					);
					taken = result.debited;
				} else {
					// Reads and archive stay all-or-nothing: the 402 path relies on
					// a refused debit leaving the balance untouched.
					const result = await debitCredits(
						trx,
						input.accountId,
						priced.usdMicros,
					);
					taken = result.ok ? priced.usdMicros : 0n;
				}
				if (taken > 0n) {
					await recordCreditsSpend(trx, input.accountId, taken);
				}
			}
			if (taken !== priced.usdMicros) {
				await recordLedgerDebit(trx, row.id, taken);
			}
		}

		const balanceAfter = await getCredits(trx, input.accountId);
		return {
			ledgerId: row.id,
			usdMicros: priced.usdMicros,
			debited: taken === priced.usdMicros,
			debitedUsdMicros: taken,
			balanceAfter,
			viaAllowance: priced.viaAllowance,
		};
	});
}

/** Ledger `quantity` for a top-up or grant: the amount in dollars, fractional
 *  (the column is `numeric`; integer division would drop the cents). */
function usdMicrosToDollars(usdMicros: bigint): number {
	return Number(usdMicros) / 1_000_000;
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
			quantity: usdMicrosToDollars(input.usdMicros),
			observedQuantity: null,
			usdMicros: -input.usdMicros,
			debitedUsdMicros: -input.usdMicros,
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
	/** Free-text origin of the grant. */
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
			quantity: usdMicrosToDollars(input.usdMicros),
			observedQuantity: null,
			usdMicros: -input.usdMicros,
			debitedUsdMicros: -input.usdMicros,
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

export type RefundInput = {
	accountId: string;
	/** The positive amount Stripe took back (a refund or a dispute), in
	 *  USD-micros. Stored in the ledger as a positive `usd_micros` (money
	 *  flowing OUT, like a charge). */
	usdMicros: bigint;
	source: string;
	/** Unique per refund step or dispute. A redelivery claws back once. */
	idempotencyKey: string;
	occurredAt?: Date;
};

/**
 * Take back credit Stripe returned to the cardholder: a `unit: "refund"`
 * ledger row plus a clamped debit of the balance, same transaction. The debit
 * takes at most the balance (never negative); the row keeps the full amount
 * and records what was actually taken, so any shortfall (credit already spent)
 * stays visible as unpaid. Idempotent on `idempotencyKey`. Not spend: the
 * monthly counter and spend cap never see it.
 */
export async function recordRefund(
	db: Kysely<Database>,
	input: RefundInput,
): Promise<{ claimed: boolean; takenUsdMicros: bigint; balance: bigint }> {
	if (input.usdMicros <= 0n) {
		throw new Error(`meter: refund must be positive, got ${input.usdMicros}`);
	}
	const occurredAt = input.occurredAt ?? new Date();
	return withTransaction(db, async (trx) => {
		await lockAccountCredits(trx, input.accountId);
		const { row, claimed } = await claimLedgerEntry(trx, {
			accountId: input.accountId,
			unit: "refund",
			quantity: usdMicrosToDollars(input.usdMicros),
			observedQuantity: null,
			usdMicros: input.usdMicros,
			debitedUsdMicros: input.usdMicros,
			source: input.source,
			idempotencyKey: input.idempotencyKey,
			occurredAt,
		});
		if (!claimed) {
			return {
				claimed: false,
				takenUsdMicros: BigInt(row.debited_usd_micros),
				balance: await getCredits(trx, input.accountId),
			};
		}
		const { debited, remaining } = await debitCreditsUpTo(
			trx,
			input.accountId,
			input.usdMicros,
		);
		if (debited !== input.usdMicros) {
			await recordLedgerDebit(trx, row.id, debited);
		}
		return { claimed: true, takenUsdMicros: debited, balance: remaining };
	});
}
