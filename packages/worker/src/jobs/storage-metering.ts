/**
 * Daily storage-overage metering.
 *
 * Runs once a day near UTC midnight. For each paid tenant where
 * `storage_used_mb > storage_limit_mb`, push a `storage_gb_months` meter
 * event for the over-quota delta prorated to 1/30 of a month (so Stripe
 * SUMs to GB-months by period end).
 *
 * Enterprise tenants with `storage_limit_mb = -1` (unlimited) are
 * exempt. Free/Hobby never generates events (no Stripe customer).
 *
 * Identifier: `storage:<slug>:<yyyy-mm-dd>` — one event per tenant per
 * day. Replays on the same day are deduped by Stripe.
 */

import { getErrorMessage, logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import { listFrozenAccountIds } from "@secondlayer/shared/db/queries/account-spend-caps";
import { getInstanceMode } from "@secondlayer/shared/mode";
import { getStripe, shouldMeterTenant } from "./stripe.ts";

const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

export function startStorageMeteringCron(): () => void {
	if (getInstanceMode() !== "platform") {
		logger.info("Storage metering cron skipped (not platform mode)");
		return () => {};
	}
	if (!getStripe()) {
		logger.info("Storage metering cron skipped (STRIPE_SECRET_KEY not set)");
		return () => {};
	}

	const tick = async () => {
		try {
			await meterOverages();
		} catch (err) {
			logger.error("Storage metering cron error", {
				error: getErrorMessage(err),
			});
		}
	};

	// 5-minute offset from boot so tenant-health has a chance to populate
	// fresh storage_used_mb values.
	const initial = setTimeout(tick, 5 * 60_000);
	const interval = setInterval(tick, INTERVAL_MS);

	return () => {
		clearTimeout(initial);
		clearInterval(interval);
	};
}

async function meterOverages(): Promise<void> {
	const stripe = getStripe();
	if (!stripe) return;

	const db = getDb();
	const rows = await db
		.selectFrom("tenants")
		.innerJoin("accounts", "accounts.id", "tenants.account_id")
		.select([
			"tenants.slug",
			"tenants.storage_used_mb",
			"tenants.storage_limit_mb",
			"accounts.id as account_id",
			"accounts.stripe_customer_id",
		])
		.where("tenants.status", "in", ["active", "limit_warning"])
		.execute();

	if (rows.length === 0) return;

	const frozen = await listFrozenAccountIds(db);
	const today = new Date().toISOString().slice(0, 10); // yyyy-mm-dd

	let pushed = 0;
	for (const row of rows) {
		if (!shouldMeterTenant({ stripeCustomerId: row.stripe_customer_id })) {
			continue;
		}
		if (frozen.has(row.account_id)) continue;
		// Enterprise unlimited storage — no overage path.
		if (row.storage_limit_mb === -1) continue;

		const used = row.storage_used_mb ?? 0;
		const overMb = used - row.storage_limit_mb;
		if (overMb <= 0) continue;

		// Prorate: 1/30 of a GB-month per day. Stripe SUMs → GB-months.
		const overGbDay = overMb / 1024 / 30;

		try {
			await stripe.billing.meterEvents.create({
				event_name: "storage_gb_months",
				payload: {
					stripe_customer_id: row.stripe_customer_id as string,
					value: overGbDay.toFixed(6),
					tenant_slug: row.slug,
				},
				identifier: `storage:${row.slug}:${today}`,
			});
			pushed++;
		} catch (err) {
			logger.warn("Failed to push storage meter event", {
				slug: row.slug,
				error: getErrorMessage(err),
			});
		}
	}

	if (pushed > 0) {
		logger.info("Storage metering pushed", { count: pushed, day: today });
	}
}
