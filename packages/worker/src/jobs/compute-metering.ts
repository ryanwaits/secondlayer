/**
 * Hourly compute-hours metering.
 *
 * Every hour, for each active tenant with a Stripe customer:
 *   - Compute `cpus * 1` hours of compute used this hour
 *   - Push a `compute_hours` meter event with deterministic idempotency
 *     identifier `compute:<slug>:<yyyy-mm-ddThh>` so Stripe dedupes on
 *     replay
 *
 * Suspended tenants produce no event — they paid for no compute this hour.
 * Free (Hobby) tenants have no Stripe customer → skipped automatically.
 *
 * Runs in platform mode only. No-ops without STRIPE_SECRET_KEY.
 */

import { getErrorMessage, logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import { listFrozenAccountIds } from "@secondlayer/shared/db/queries/account-spend-caps";
import { getInstanceMode } from "@secondlayer/shared/mode";
import { getStripe, shouldMeterTenant } from "./stripe.ts";

const INTERVAL_MS = 60 * 60 * 1000; // 1h

export function startComputeMeteringCron(): () => void {
	if (getInstanceMode() !== "platform") {
		logger.info("Compute metering cron skipped (not platform mode)");
		return () => {};
	}
	if (!getStripe()) {
		logger.info("Compute metering cron skipped (STRIPE_SECRET_KEY not set)");
		return () => {};
	}

	const tick = async () => {
		try {
			await meterActiveTenants();
		} catch (err) {
			logger.error("Compute metering cron error", {
				error: getErrorMessage(err),
			});
		}
	};

	// 2-minute offset from boot so the idle-pause + health crons land first
	// and we have fresh tenant state to read.
	const initial = setTimeout(tick, 120_000);
	const interval = setInterval(tick, INTERVAL_MS);

	return () => {
		clearTimeout(initial);
		clearInterval(interval);
	};
}

async function meterActiveTenants(): Promise<void> {
	const stripe = getStripe();
	if (!stripe) return;

	const db = getDb();
	// Join tenants → accounts so we only enumerate paid tenants in one
	// round-trip. A Hobby tenant whose account has `stripe_customer_id`
	// set from a prior paid period gets filtered by the `shouldMeterTenant`
	// check below — but we still fetch it so the check lives in code, not
	// SQL (makes future rules like "enterprise without sub" easier to add).
	const rows = await db
		.selectFrom("tenants")
		.innerJoin("accounts", "accounts.id", "tenants.account_id")
		.select([
			"tenants.slug",
			"tenants.cpus",
			"accounts.id as account_id",
			"accounts.stripe_customer_id",
		])
		.where("tenants.status", "=", "active")
		.execute();

	if (rows.length === 0) return;

	// Frozen accounts skip metering entirely — cap hit, no more billable
	// events this cycle. The threshold cron flips frozen_at on/off.
	const frozen = await listFrozenAccountIds(db);

	// Bucket by the hour we just closed (not current) — cleaner mental
	// model than "partial hours" and matches Stripe's 1h minimum meter
	// granularity.
	const now = new Date();
	const bucket = new Date(now);
	bucket.setUTCMinutes(0, 0, 0);
	const identifierSuffix = bucket.toISOString().slice(0, 13); // yyyy-mm-ddThh

	let pushed = 0;
	for (const row of rows) {
		if (!shouldMeterTenant({ stripeCustomerId: row.stripe_customer_id })) {
			continue;
		}
		if (frozen.has(row.account_id)) continue;
		const cpus = Number(row.cpus);
		if (!Number.isFinite(cpus) || cpus <= 0) continue;

		try {
			await stripe.billing.meterEvents.create({
				event_name: "compute_hours",
				payload: {
					stripe_customer_id: row.stripe_customer_id as string,
					value: cpus.toString(),
					tenant_slug: row.slug,
				},
				identifier: `compute:${row.slug}:${identifierSuffix}`,
			});
			pushed++;
		} catch (err) {
			logger.warn("Failed to push compute meter event", {
				slug: row.slug,
				error: getErrorMessage(err),
			});
		}
	}

	if (pushed > 0) {
		logger.info("Compute metering pushed", {
			count: pushed,
			bucket: identifierSuffix,
		});
	}
}
