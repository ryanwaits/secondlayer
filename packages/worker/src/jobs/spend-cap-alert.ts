/**
 * Daily spend-cap threshold monitor.
 *
 * For each account with a Stripe customer + a `monthly_cap_cents`, fetch
 * the upcoming Stripe invoice and compare to the cap:
 *   - Projected spend >= threshold_pct (default 80%) → send email + bump
 *     `alert_sent_at` (debounced per cycle)
 *   - Projected spend >= monthly_cap_cents → set `frozen_at` so the
 *     metering crons stop emitting events for this account
 *
 * Frozen state is cleared on the next cycle's `invoice.paid` webhook
 * (see routes/webhooks-stripe.ts) or when the user raises their cap.
 *
 * No-op without STRIPE_SECRET_KEY or in non-platform mode.
 */

import { getErrorMessage, logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import { upsertCaps } from "@secondlayer/shared/db/queries/account-spend-caps";
import { getInstanceMode } from "@secondlayer/shared/mode";
import { getStripe } from "./stripe.ts";

const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h — threshold alerts are not a
// minute-to-minute concern; daily is plenty and keeps Stripe API volume low.

export function startSpendCapAlertCron(): () => void {
	if (getInstanceMode() !== "platform") {
		logger.info("Spend-cap alert cron skipped (not platform mode)");
		return () => {};
	}
	if (!getStripe()) {
		logger.info("Spend-cap alert cron skipped (STRIPE_SECRET_KEY not set)");
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
	const stripe = getStripe();
	if (!stripe) return;

	const db = getDb();

	// Every account that (a) has a Stripe customer (paid) AND
	// (b) has a monthly cap set. No cap = no enforcement.
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
			"accounts.stripe_customer_id",
			"account_spend_caps.monthly_cap_cents",
			"account_spend_caps.alert_threshold_pct",
			"account_spend_caps.alert_sent_at",
			"account_spend_caps.frozen_at",
		])
		.where("accounts.stripe_customer_id", "is not", null)
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
	email: string;
	stripe_customer_id: string | null;
	monthly_cap_cents: number | null;
	alert_threshold_pct: number;
	alert_sent_at: Date | null;
	frozen_at: Date | null;
}

async function checkOneCap(row: CapRow): Promise<void> {
	const stripe = getStripe();
	if (!stripe || !row.stripe_customer_id || row.monthly_cap_cents == null)
		return;

	const db = getDb();

	// Upcoming invoice = Stripe's projection of what we'd bill right now.
	// Sums fixed-price line items + metered line items the customer has
	// accrued this cycle.
	const upcoming = await stripe.invoices
		.createPreview({ customer: row.stripe_customer_id })
		.catch((err) => {
			// No active subscription → no upcoming invoice. Not an error state
			// for us — we just skip.
			if (err?.code === "invoice_upcoming_none") return null;
			throw err;
		});
	if (!upcoming) return;

	const projected = upcoming.amount_due; // cents
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

	// Threshold alert. Debounce: only send once per cycle. Upcoming
	// invoice's `period_start` is the cycle anchor; if `alert_sent_at`
	// predates this cycle, resend.
	const cycleStart = upcoming.period_start
		? new Date(upcoming.period_start * 1000)
		: null;
	const alertAlreadySentThisCycle =
		row.alert_sent_at && cycleStart && row.alert_sent_at >= cycleStart;

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
			? `Your projected spend this cycle ($${projected$}) has reached your configured cap of $${cap$}. Usage metering is paused for the rest of this billing period — your instances keep running, but we won't bill further overages until the next cycle. Raise your cap in the dashboard if you want to continue accruing overages this period.`
			: `Your projected spend this cycle is $${projected$} — ${pct}% of your $${cap$} cap. No action required; we'll freeze overage metering automatically if you reach 100%. Adjust your cap in Billing settings if needed.`;

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
