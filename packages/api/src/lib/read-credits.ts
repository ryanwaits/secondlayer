import { randomUUID } from "node:crypto";
import { meter } from "@secondlayer/platform/billing/meter";
import {
	GHOST_ACCOUNT_ROWS_LIMIT,
	MIN_CREDITED_USD_MICROS,
	ROWS_DELIVERED_MONTHLY_ALLOWANCE,
	nextMonthResetLabel,
} from "@secondlayer/platform/billing/prices";
import { accountSpendState } from "@secondlayer/platform/db/queries/account-credits";
import {
	lifetimeQuantity,
	monthBounds,
	monthlyQuantity,
} from "@secondlayer/platform/db/queries/usage-ledger";
import { getDb } from "@secondlayer/shared/db";
import { isPlatformMode } from "@secondlayer/shared/mode";
import { DOCS_KEY_TTL_MS } from "../auth/mint.ts";
import { invalidCredentialError } from "../auth/read-plane.ts";
import { productEventsEnabled, trackProductEvent } from "./product-events.ts";
import { getSlotCounter } from "./slot-counter.ts";

export {
	MIN_CREDITED_USD_MICROS,
	isOverMonthlyCreditCap,
} from "@secondlayer/platform/billing/prices";

/**
 * Shared pay-as-you-go read metering for Index + Streams. Every keyed read
 * with an account meters `rows.delivered` (`@secondlayer/platform/billing/meter`):
 * the first 1M rows/month are free (the allowance), rows past it debit the
 * prepaid `account_credits` balance. One balance covers both surfaces.
 */

/**
 * Platform only: a tenant with no account has nothing to meter or debit, so
 * only a first-party `internal` one may read. Anything else is a seed
 * credential that slipped past the token store; refuse it. Anon (no tenant)
 * is the auth layer's call, not this gate's.
 */
export function assertMeterableTenant(
	tenant: { account_id?: string; tier?: string } | undefined,
): void {
	if (!isPlatformMode() || !tenant) return;
	if (tenant.account_id || tenant.tier === "internal") return;
	throw invalidCredentialError();
}

export type Credited = { accountId: string; balance: bigint };

/**
 * A free-tier account with enough prepaid balance → pay-as-you-go
 * (unthrottled — see `indexRateLimit`/`streamsRateLimit`), else undefined.
 * Only free-tier account-backed callers qualify: internal (first-party
 * service) callers already have unmetered headroom; anon callers have no
 * account credits. This gate no longer decides whether a read is metered —
 * `meterRowsDelivered` meters every keyed read regardless — it only decides
 * whether the rate limit is bypassed.
 *
 * Spend cap: once this month's credit spend reaches the account's monthly
 * cap, stop granting the unthrottled lane (the hard stop metering itself
 * enforces is in `meter()`). An internal account is always credited.
 */
export async function resolveCreditedAccount(
	accountId: string | undefined,
	tier: string | undefined,
): Promise<Credited | undefined> {
	if (!isPlatformMode() || !accountId || tier === "internal") return undefined;
	const state = await accountSpendState(getDb(), accountId);
	return state.canRead ? { accountId, balance: state.balance } : undefined;
}

/**
 * Meter one page of rows delivered to a keyed reader. Every account_id-bearing
 * read counts against the monthly allowance and, past it, debits the balance
 * — not just accounts that have already topped up (`resolveCreditedAccount`
 * governs the rate-limit bypass only, not whether a read is metered). A read
 * that STARTS under the allowance and straddles it is always served in full;
 * only its overflow portion can come back `debited: false` if the balance is
 * short (`checkRowsAllowance` below is what stops a read from starting once
 * the account is already over the allowance with nothing left to charge — by
 * the time this runs the response is already decided, so it can only make
 * the overflow visible, never unblock or claw back what was served).
 */
export async function meterRowsDelivered(
	accountId: string,
	rows: number,
	source: string,
	apiKeyId?: string | null,
): Promise<void> {
	if (rows <= 0) return;
	const { ledgerId } = await meter(getDb(), {
		accountId,
		unit: "rows.delivered",
		quantity: rows,
		source,
		idempotencyKey: randomUUID(),
		apiKeyId: apiKeyId ?? null,
	});
	if (productEventsEnabled()) {
		trackFirstRead(accountId, ledgerId, source).catch(() => {});
	}
}

/** Accounts this process has already checked for a first read. Cleared when
 *  it grows past `KNOWN_READERS_MAX`, which only costs a re-check. */
const knownReaders = new Set<string>();
const KNOWN_READERS_MAX = 50_000;

/**
 * `first_request` once per account: when the account's earliest
 * `rows.delivered` row is the one just written. One indexed lookup per
 * account per process, off the request path. A ghost (signed-out docs key)
 * goes out without a person profile, under the ghost's id like its mint.
 */
async function trackFirstRead(
	accountId: string,
	ledgerId: string,
	source: string,
): Promise<void> {
	if (knownReaders.has(accountId)) return;
	const first = await getDb()
		.selectFrom("usage_ledger")
		.innerJoin("accounts", "accounts.id", "usage_ledger.account_id")
		.select(["usage_ledger.id", "accounts.ghost"])
		.where("usage_ledger.account_id", "=", accountId)
		.where("usage_ledger.unit", "=", "rows.delivered")
		.orderBy("usage_ledger.occurred_at")
		.orderBy("usage_ledger.id")
		.limit(1)
		.executeTakeFirst();
	// Remembered only after the read: concurrent first reads each check, and
	// only the one holding the earliest row sends.
	if (knownReaders.size >= KNOWN_READERS_MAX) knownReaders.clear();
	knownReaders.add(accountId);
	if (first?.id !== ledgerId) return;
	trackProductEvent(
		{ distinctId: accountId, anonymous: first.ghost },
		{ event: "first_request", properties: { source, ghost: first.ghost } },
	);
}

function topUpUrl(): string {
	return `${process.env.DASHBOARD_URL ?? "https://secondlayer.tools"}/account/credits`;
}

export type InsufficientCreditsBody = {
	error: "insufficient_credits";
	shortfall_usd_micros: number;
	hint: string;
	top_up_url: string;
};

export type SpendCapReachedBody = {
	error: "spend_cap_reached";
	message: string;
};

export type RowsLimitReachedBody = {
	error: "rows_limit_reached";
	message: string;
};

export type ReadRefusalBody =
	| InsufficientCreditsBody
	| SpendCapReachedBody
	| RowsLimitReachedBody;

const GHOST_ROWS_REFUSAL: RowsLimitReachedBody = {
	error: "rows_limit_reached",
	message: `This docs key has read its ${GHOST_ACCOUNT_ROWS_LIMIT.toLocaleString("en-US")} rows. Make a lasting key at https://secondlayer.tools/signin.`,
};

/** Reads one ghost account may have in flight at once. The row cap is checked
 *  before a read and counted after it, so N parallel reads at 99,999 rows all
 *  pass; holding this to 2 bounds the overshoot to 2 pages. */
export const GHOST_READS_IN_FLIGHT = 2;

export const GHOST_READS_BUSY_MESSAGE =
	"A docs key reads two requests at a time. Retry in a moment.";

/** A ghost read is a page or two; a slot whose holder died frees itself. */
const GHOST_READ_SLOT_TTL_MS = 60_000;

/** Ghost-ness never changes (a ghost cannot gain an email), so it is looked
 *  up once per account per process. Cleared when it grows past
 *  `KNOWN_ACCOUNTS_MAX`, which only costs a re-check. */
const ghostByAccount = new Map<string, boolean>();
const KNOWN_ACCOUNTS_MAX = 50_000;

export async function isGhostAccount(accountId: string): Promise<boolean> {
	const known = ghostByAccount.get(accountId);
	if (known !== undefined) return known;
	const row = await getDb()
		.selectFrom("accounts")
		.select("ghost")
		.where("id", "=", accountId)
		.executeTakeFirst();
	const ghost = row?.ghost ?? false;
	if (ghostByAccount.size >= KNOWN_ACCOUNTS_MAX) ghostByAccount.clear();
	ghostByAccount.set(accountId, ghost);
	return ghost;
}

/**
 * Take one of a ghost account's `GHOST_READS_IN_FLIGHT` read slots, before
 * `checkRowsAllowance` and held until the read has been metered. Returns a
 * `release` to call once the read is done, or `"busy"` when the ghost
 * already has that many reads running. Nothing is held for a non-ghost,
 * internal or self-host caller. Slots are shared across API replicas when
 * Redis is configured (`lib/slot-counter.ts`).
 */
export async function beginGhostRead(
	accountId: string | undefined,
	tier: string | undefined,
): Promise<"busy" | { release: () => Promise<void> }> {
	const none = { release: async () => {} };
	if (!isPlatformMode() || !accountId || tier === "internal") return none;
	if (!(await isGhostAccount(accountId))) return none;
	const release = await getSlotCounter().acquire(
		`ghost-read:${accountId}`,
		GHOST_READS_IN_FLIGHT,
		GHOST_READ_SLOT_TTL_MS,
	);
	return release ? { release } : "busy";
}

/**
 * Pre-read gate: once a keyed account's `rows.delivered` this UTC calendar
 * month has reached the free allowance, two things can refuse the read
 * BEFORE anything is served:
 *
 *   1. A configured monthly spend cap already reached this month
 *      (`spend_cap_reached`) — checked first, since it's a deliberate limit
 *      the account set, not a balance problem.
 *   2. Balance short of `MIN_CREDITED_USD_MICROS` (one page's worth) — the
 *      same threshold `resolveCreditedAccount` uses for the rate-limit
 *      bypass (`insufficient_credits` + `shortfall_usd_micros`, plus a
 *      top-up hint/link — the same error code the archive fetch gate's 402
 *      uses, `routes/archive.ts`).
 *
 * A ghost account (a signed-out reader's docs key) is refused sooner: once
 * it has read `GHOST_ACCOUNT_ROWS_LIMIT` rows in its whole life
 * (`rows_limit_reached`), whatever its month. Its key lives a day, so its
 * month's rows are its lifetime's except in the first day of a month; only
 * then, or past the ghost limit, does this read the account row at all.
 * Callers run it under `beginGhostRead`, which keeps parallel reads from all
 * passing this check at once.
 *
 * No-op (never refuses — returns `null`) for anon, internal (key tier or
 * account), or self-host:
 * the allowance is an account concept, and only platform mode meters reads
 * at all. A read that starts under the allowance is never refused here even
 * if it will straddle it — the free rows and the cap are both allowance-
 * gated, not balance-gated; see `meterRowsDelivered`.
 */
export async function checkRowsAllowance(
	accountId: string | undefined,
	tier: string | undefined,
	now: Date = new Date(),
): Promise<ReadRefusalBody | null> {
	if (!isPlatformMode() || !accountId || tier === "internal") return null;
	const db = getDb();
	const usedThisMonth = await monthlyQuantity(
		db,
		accountId,
		"rows.delivered",
		now,
	);
	const monthJustTurned =
		now.getTime() - monthBounds(now).start.getTime() < DOCS_KEY_TTL_MS;
	if (usedThisMonth < GHOST_ACCOUNT_ROWS_LIMIT && !monthJustTurned) return null;

	const account = await db
		.selectFrom("accounts")
		.select(["ghost", "internal"])
		.where("id", "=", accountId)
		.executeTakeFirst();
	if (account?.internal) return null;
	if (account?.ghost) {
		const used =
			usedThisMonth >= GHOST_ACCOUNT_ROWS_LIMIT
				? usedThisMonth
				: await lifetimeQuantity(db, accountId, "rows.delivered");
		return used >= GHOST_ACCOUNT_ROWS_LIMIT ? GHOST_ROWS_REFUSAL : null;
	}
	if (usedThisMonth < ROWS_DELIVERED_MONTHLY_ALLOWANCE) return null;

	const state = await accountSpendState(db, accountId, now);
	if (state.readBlock === "cap") {
		return {
			error: "spend_cap_reached",
			message: `You reached your monthly spend cap. Reads past your free 1M rows are paused until ${nextMonthResetLabel(now)} or until you raise the cap at https://secondlayer.tools/account/credits#cap.`,
		};
	}
	if (state.readBlock === null) return null;
	return {
		error: "insufficient_credits",
		shortfall_usd_micros: Number(MIN_CREDITED_USD_MICROS - state.balance),
		hint: "Add usage credits to keep reading rows past the free monthly allowance.",
		top_up_url: topUpUrl(),
	};
}
