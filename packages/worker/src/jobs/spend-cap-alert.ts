/**
 * Daily spend-cap threshold monitor for the pay-as-you-go credits rail.
 *
 * The cap governs the only live variable spend: a free-tier account's prepaid
 * `account_credits` consumed per read this calendar month. (The earlier version
 * projected the Stripe *subscription* invoice — flat base price, since no
 * metered overage is emitted — so it could never trip; see the 2026-06-18
 * billing audit.) For each account with a `monthly_cap_cents` set:
 *   - Month's credit spend >= threshold_pct (default 80%) → send email + bump
 *     `alert_sent_at` (debounced once per calendar month)
 *   - Month's credit spend >= monthly_cap_cents → set `frozen_at` (display +
 *     email). The hard stop is enforced in real time by
 *     `resolveCreditedAccount` (api/lib/read-credits.ts); this flag mirrors it.
 *   - Back under cap with a stale freeze (month rolled over) → clear it.
 *
 * Also cleared on `invoice.paid` webhook or when the user raises their cap.
 * No-op in non-platform mode.
 */

import { getMonthlyCreditsSpend } from "@secondlayer/platform/db/queries/account-credits";
import {
	clearFreeze,
	upsertCaps,
} from "@secondlayer/platform/db/queries/account-spend-caps";
import { getErrorMessage, logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
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

async function checkAllCaps(): Promise<void> {
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

async function sendCapAlert(
	row: CapRow,
	projectedCents: number,
	capCents: number,
	kind: "threshold" | "frozen",
): Promise<void> {
	if (!row.email) return; // no address to alert (ghost account — shouldn't have a cap)
	const resendKey = process.env.RESEND_API_KEY;
	if (!resendKey) {
		logger.warn("RESEND_API_KEY unset — skipping cap email", {
			accountId: row.account_id,
			kind,
		});
		return;
	}

	const from =
		process.env.EMAIL_FROM ?? "Secondlayer <noreply@secondlayer.tools>";
	const projected$ = (projectedCents / 100).toFixed(2);
	const cap$ = (capCents / 100).toFixed(2);
	const pct = Math.round((projectedCents / capCents) * 100);

	const subject =
		kind === "frozen"
			? "Your Secondlayer spend cap was reached"
			: `You're at ${pct}% of your Secondlayer spend cap`;
	const body =
		kind === "frozen"
			? `Your pay-as-you-go credit spend this month ($${projected$}) has reached your configured cap of $${cap$}. Metered reads are paused for the rest of the month — your prepaid balance is untouched, and reads fall back to the free-tier window. Raise your cap in Billing to keep reading on credits this month; it resets automatically next month.`
			: `Your pay-as-you-go credit spend this month is $${projected$} — ${pct}% of your $${cap$} cap. No action required; we'll pause metered reads automatically if you reach 100%. Adjust your cap in Billing settings if needed.`;

	const res = await fetch("https://api.resend.com/emails", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${resendKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			from,
			to: [row.email],
			subject,
			text: body,
		}),
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`Resend ${res.status}: ${text.slice(0, 200)}`);
	}
}
