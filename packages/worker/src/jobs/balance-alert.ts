/**
 * Balance-runway email alerts: at $0 the workload host stops a tenant's
 * delivery service within 5 minutes (`packages/workload/src/provisioner.ts`
 * `pollCredits`) with no warning to the customer first. This cron closes
 * that gap — hourly, for every account with recent spend or a delivery
 * service that isn't `none`:
 *
 *   - `low` (runway ≤7d) & `notify7d` & not yet sent this crossing → email
 *   - `crit` (runway ≤2d) & `notify2d` & not yet sent this crossing → email
 *   - `stopped` (service stopped, balance ≤$0) & `notify2d` & not yet sent
 *     → email
 *   - runway back over 7 days (a top-up) → clear every debounce mark, so
 *     the next crossing alerts again
 *
 * Runway/level math mirrors `apps/web/src/lib/usage.ts` exactly (Design's
 * Definitions) via the shared `@secondlayer/platform/billing/runway`
 * helpers, so the email and the credits page never disagree. No-op in
 * non-platform mode.
 */

import { balanceLevel, runwayDays } from "@secondlayer/platform/billing/runway";
import {
	clearSentBalanceAlerts,
	getBalanceAlerts,
	upsertBalanceAlerts,
} from "@secondlayer/platform/db/queries/account-balance-alerts";
import { getCredits } from "@secondlayer/platform/db/queries/account-credits";
import {
	accountsToCheckForBalanceAlerts,
	burnRateUsdMicros,
	deliveryServiceSnapshot,
} from "@secondlayer/platform/db/queries/usage-ledger";
import { getErrorMessage, logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import { getInstanceMode } from "@secondlayer/shared/mode";

const INTERVAL_MS = 60 * 60 * 1000; // hourly — a runway crossing doesn't
// need minute-level precision; the hard stop is real-time on the read/
// provisioner path regardless.

const DASHBOARD_LINK = "https://secondlayer.tools/account/credits";

export function startBalanceAlertCron(): () => void {
	if (getInstanceMode() !== "platform") {
		logger.info("Balance alert cron skipped (not platform mode)");
		return () => {};
	}

	const tick = async () => {
		try {
			await checkAllBalances();
		} catch (err) {
			logger.error("Balance alert cron error", {
				error: getErrorMessage(err),
			});
		}
	};

	// 10-minute offset, same as the spend-cap cron: gives compute/storage
	// metering a moment to settle after a fresh deploy.
	const initial = setTimeout(tick, 10 * 60_000);
	const interval = setInterval(tick, INTERVAL_MS);

	return () => {
		clearTimeout(initial);
		clearInterval(interval);
	};
}

interface AccountRow {
	id: string;
	/** NULL only for ghost accounts (no address to alert). */
	email: string | null;
}

export async function checkAllBalances(now: Date = new Date()): Promise<void> {
	const db = getDb();
	const accountIds = await accountsToCheckForBalanceAlerts(db, now);
	if (accountIds.length === 0) return;

	const rows = await db
		.selectFrom("accounts")
		.select(["id", "email"])
		.where("id", "in", accountIds)
		.execute();

	for (const row of rows) {
		try {
			await checkOneBalance(row, now);
		} catch (err) {
			logger.warn("Failed to check balance alert for account", {
				accountId: row.id,
				error: getErrorMessage(err),
			});
		}
	}
}

export async function checkOneBalance(
	row: AccountRow,
	now: Date = new Date(),
): Promise<void> {
	const db = getDb();
	const [balance, rateDayUsdMicros, service, alerts] = await Promise.all([
		getCredits(db, row.id),
		burnRateUsdMicros(db, row.id, now),
		deliveryServiceSnapshot(db, row.id, now),
		getBalanceAlerts(db, row.id),
	]);

	const runway = runwayDays(balance, rateDayUsdMicros);
	const level = balanceLevel({
		serviceState: service.state,
		balanceUsdMicros: balance,
		runwayDays: runway,
	});

	const notify7d = alerts?.notify_7d ?? true;
	const notify2d = alerts?.notify_2d ?? true;
	const hasSentMark = Boolean(
		alerts?.sent_7d_at || alerts?.sent_2d_at || alerts?.sent_stopped_at,
	);

	// Re-arm: a top-up pushed runway back over 7 days. Clear every debounce
	// mark so the next crossing alerts again, and skip sending this tick —
	// there's nothing to warn about right now.
	if (runway > 7 && hasSentMark) {
		await clearSentBalanceAlerts(db, row.id);
		return;
	}

	if (level === "stopped" && notify2d && !alerts?.sent_stopped_at) {
		await upsertBalanceAlerts(db, row.id, { sent_stopped_at: now });
		await sendBalanceAlert(row, "stopped", { now, runway, rateDayUsdMicros });
		return;
	}
	if (level === "crit" && notify2d && !alerts?.sent_2d_at) {
		await upsertBalanceAlerts(db, row.id, { sent_2d_at: now });
		await sendBalanceAlert(row, "crit", { now, runway, rateDayUsdMicros });
		return;
	}
	if (level === "low" && notify7d && !alerts?.sent_7d_at) {
		await upsertBalanceAlerts(db, row.id, { sent_7d_at: now });
		await sendBalanceAlert(row, "low", { now, runway, rateDayUsdMicros });
	}
}

function formatUsdPerDay(usdMicros: bigint): string {
	return `$${(Number(usdMicros) / 1_000_000).toFixed(2)}`;
}

/** Now + runway days, date only, UTC, "Mon D" — matches Definitions'
 *  "Runs out" and `apps/web/src/lib/usage.ts`'s `runsOutDate` exactly:
 *  floor `runway` to whole days, then add that many calendar days to
 *  `now`'s UTC date. */
function runsOutDate(now: Date, runway: number): string {
	const at = new Date(
		Date.UTC(
			now.getUTCFullYear(),
			now.getUTCMonth(),
			now.getUTCDate() + Math.floor(runway),
		),
	);
	return at.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		timeZone: "UTC",
	});
}

async function sendBalanceAlert(
	account: AccountRow,
	kind: "low" | "crit" | "stopped",
	ctx: { now: Date; runway: number; rateDayUsdMicros: bigint },
): Promise<void> {
	if (!account.email) return; // no address to alert (ghost account)
	const resendKey = process.env.RESEND_API_KEY;
	if (!resendKey) {
		logger.warn("RESEND_API_KEY unset — skipping balance alert email", {
			accountId: account.id,
			kind,
		});
		return;
	}

	const from =
		process.env.EMAIL_FROM ?? "Secondlayer <noreply@secondlayer.tools>";

	let subject: string;
	let body: string;
	if (kind === "stopped") {
		subject = "Your delivery service stopped";
		body = `Your balance reached $0, so your delivery service stopped and webhooks aren't delivering. Add credits and it starts again within 5 minutes: ${DASHBOARD_LINK}`;
	} else {
		const days = Math.floor(ctx.runway);
		subject =
			kind === "low"
				? `About ${days} days of credit left`
				: "Under 2 days of credit left";
		body = `At ${formatUsdPerDay(ctx.rateDayUsdMicros)}/day your balance runs out around ${runsOutDate(ctx.now, ctx.runway)}. Your delivery service stops then, and webhooks stop delivering until you add credits. Add credits: ${DASHBOARD_LINK}`;
	}

	const res = await fetch("https://api.resend.com/emails", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${resendKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ from, to: [account.email], subject, text: body }),
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`Resend ${res.status}: ${text.slice(0, 200)}`);
	}
}
