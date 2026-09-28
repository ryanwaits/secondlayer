/**
 * Daily spend-cap threshold monitor for the pay-as-you-go credits rail.
 *
 * The cap governs a free-tier account's total prepaid `account_credits`
 * spend this calendar month — every unit `meter()` debits (hosted reads,
 * the delivery service's memory/storage, webhook events), not just reads.
 * Only reads past the free 1M rows actually pause once it's reached; webhooks
 * and the delivery service keep running. (The earlier version projected the
 * Stripe invoice — flat base price, since no metered overage is emitted —
 * so it could never trip; see the 2026-06-18 billing audit.) For each
 * account with a `monthly_cap_cents` set:
 *   - Month's credit spend >= threshold_pct (default 80%) → send email + bump
 *     `alert_sent_at` (debounced once per calendar month)
 *   - Month's credit spend >= monthly_cap_cents → set `frozen_at` (display +
 *     email). The hard stop is enforced in real time on the read path —
 *     `checkRowsAllowance` (`packages/api/src/lib/read-credits.ts`) refuses a
 *     keyed read past the free rows with 402 `spend_cap_reached` once the cap
 *     is reached; this flag mirrors that for the dashboard/email.
 *   - Back under cap with a stale freeze (month rolled over) → clear it.
 *
 * Also cleared on `invoice.paid` webhook or when the user raises their cap.
 * No-op in non-platform mode.
 */

import { nextMonthResetLabel } from "@secondlayer/platform/billing/prices";
import { getMonthlyCreditsSpend } from "@secondlayer/platform/db/queries/account-credits";
import {
	clearFreeze,
	upsertCaps,
} from "@secondlayer/platform/db/queries/account-spend-caps";
import { getErrorMessage, logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import { renderEmail, sendEmail } from "@secondlayer/shared/email";
import { getInstanceMode } from "@secondlayer/shared/mode";

const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h — threshold alerts are not a
// minute-to-minute concern; the hard stop is enforced in real time on the read
// path, so daily is plenty for the courtesy alert + display freeze.

/** Cap dimensions are stored in cents; credit spend in USD-micros (1¢ = 10k µ$). */
const USD_MICROS_PER_CENT = 10_000n;

export function startSpendCapAlertCron(): () => void {
	if (getInstanceMode() !== "platform") {
		logger.info("Spend-cap alert cron skipped (not platform mode)");
		return () => {};
	}

	const tick = async () => {
		try {
			await checkAllCaps();
		} catch (err) {
			logger.error("Spend-cap alert cron error", {
				error: getErrorMessage(err),
			});
		}
	};

	// 10-minute offset so compute/storage metering have settled.
	const initial = setTimeout(tick, 10 * 60_000);
	const interval = setInterval(tick, INTERVAL_MS);

	return () => {
		clearTimeout(initial);
		clearInterval(interval);
	};
}

export async function checkAllCaps(): Promise<void> {
	const db = getDb();

	// Every account with a monthly cap set. No cap = no enforcement. The cap
	// bites the credits rail, which only free-tier accounts use — paid accounts
	// with a cap simply show zero credit spend and never trip.
	const rows = await db
		.selectFrom("accounts")
		.innerJoin(
			"account_spend_caps",
			"account_spend_caps.account_id",
			"accounts.id",
		)
		.select([
			"accounts.id as account_id",
			"accounts.email",
			"account_spend_caps.monthly_cap_cents",
			"account_spend_caps.alert_threshold_pct",
			"account_spend_caps.alert_sent_at",
			"account_spend_caps.frozen_at",
		])
		.where("account_spend_caps.monthly_cap_cents", "is not", null)
		.execute();

	for (const row of rows) {
		try {
			await checkOneCap(row);
		} catch (err) {
			logger.warn("Failed to check cap for account", {
				accountId: row.account_id,
				error: getErrorMessage(err),
			});
		}
	}
}

interface CapRow {
	account_id: string;
	/** NULL only for ghost accounts (no address to alert). */
	email: string | null;
	monthly_cap_cents: number | null;
	alert_threshold_pct: number;
	alert_sent_at: Date | null;
	frozen_at: Date | null;
}

async function checkOneCap(row: CapRow): Promise<void> {
	if (row.monthly_cap_cents == null) return;

	const db = getDb();

	// This calendar month's pay-as-you-go credit spend, in cents. getMonthly
	// CreditsSpend returns 0 once the month rolls over, so the cap auto-resets.
	const spentMicros = await getMonthlyCreditsSpend(db, row.account_id);
	const projected = Number(spentMicros / USD_MICROS_PER_CENT); // cents
	const cap = row.monthly_cap_cents;
	const threshold = Math.floor((cap * row.alert_threshold_pct) / 100);

	// Freeze + alert: cap hit. Strongest action first.
	if (projected >= cap && !row.frozen_at) {
		await upsertCaps(db, row.account_id, { frozen_at: new Date() });
		await sendCapAlert(row, projected, cap, "frozen");
		logger.info("Account spend cap hit — frozen", {
			accountId: row.account_id,
			projected,
			cap,
		});
		return;
	}

	// Auto-unfreeze a stale display freeze once spend resets under the cap
	// (typically the new month). Real-time enforcement already resumed reads.
	if (projected < cap && row.frozen_at) {
		await clearFreeze(db, row.account_id);
		logger.info("Account spend back under cap — unfrozen", {
			accountId: row.account_id,
			projected,
			cap,
		});
		return;
	}

	// Threshold alert. Debounce: once per calendar month. The credit spend
	// counter is monthly, so anchor the resend window to the month start.
	const now = new Date();
	const monthStart = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
	);
	const alertAlreadySentThisCycle =
		row.alert_sent_at && row.alert_sent_at >= monthStart;

	if (projected >= threshold && !alertAlreadySentThisCycle) {
		await upsertCaps(db, row.account_id, { alert_sent_at: new Date() });
		await sendCapAlert(row, projected, cap, "threshold");
		logger.info("Account spend cap threshold reached — alerted", {
			accountId: row.account_id,
			projected,
			cap,
			thresholdPct: row.alert_threshold_pct,
		});
	}
}

const CAP_SETTING_URL = "https://secondlayer.tools/account/credits#cap";

async function sendCapAlert(
	row: CapRow,
	projectedCents: number,
	capCents: number,
	kind: "threshold" | "frozen",
	now: Date = new Date(),
): Promise<void> {
	if (!row.email) return; // no address to alert (ghost account — shouldn't have a cap)

	const spent$ = `$${(projectedCents / 100).toFixed(2)}`;
	const cap$ = `$${(capCents / 100).toFixed(2)}`;
	const pct = Math.round((projectedCents / capCents) * 100);
	const resets = nextMonthResetLabel(now);

	// The cap counts total monthly spend (memory, storage, webhooks, rows —
	// every unit `meter()` debits, @secondlayer/platform/billing/meter.ts),
	// not just Index/Streams reads; only reads past the free 1M rows pause
	// once it's reached (`checkRowsAllowance`,
	// packages/api/src/lib/read-credits.ts) — the copy must say both.
	const subject =
		kind === "frozen"
			? "You reached your monthly spend cap"
			: `You've used ${pct}% of your monthly spend cap`;
	const paragraphs =
		kind === "frozen"
			? [
					`You've spent ${cap$} this month and reached your monthly cap. Hosted Index and Streams reads past your free 1M rows are paused until ${resets} or until you raise the cap. Your balance is untouched, and webhooks and your delivery service keep running.`,
				]
			: [
					`You've spent ${spent$} this month, ${pct}% of your ${cap$} monthly cap. When you reach the cap, hosted Index and Streams reads past your free 1M rows pause until ${resets} or until you raise the cap. Webhooks and your delivery service keep running.`,
				];

	const { html, text } = renderEmail({
		heading: subject,
		paragraphs,
		facts: [
			{ label: "Spent this month", value: spent$ },
			{ label: "Cap", value: cap$ },
			{ label: "Resets", value: resets },
		],
		cta: {
			label: kind === "frozen" ? "Raise your cap" : "Change your cap",
			url: CAP_SETTING_URL,
		},
	});

	await sendEmail({ to: row.email, subject, html, text });
}
