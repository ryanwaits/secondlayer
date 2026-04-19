/**
 * Tenant trial lifecycle cron.
 *
 * - Hourly: suspend any tenant whose 14-day trial has lapsed (delegates
 *   to provisioner's stop, keeps volume).
 * - Hourly: hard-delete tenants suspended for >30 days (volume included).
 *
 * Runs only in platform mode — OSS/dedicated modes don't have a trial
 * concept. Safe to run on OSS (listExpiredTrials returns empty) but we
 * gate on INSTANCE_MODE to skip the provisioner HTTP call.
 */

import { getErrorMessage, logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import {
	listExpiredTrials,
	listSuspendedOlderThan,
	setTenantStatus,
} from "@secondlayer/shared/db/queries/tenants";
import { getInstanceMode } from "@secondlayer/shared/mode";

const INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const DELETE_AFTER_MS = 30 * 24 * 60 * 60 * 1000; // 30 days post-suspension

export function startTenantTrialCron(): () => void {
	if (getInstanceMode() !== "platform") {
		logger.info("Tenant trial cron skipped (not platform mode)");
		return () => {};
	}

	const tick = async () => {
		try {
			await suspendExpiredTrials();
			await purgeOldSuspended();
		} catch (err) {
			logger.error("Tenant trial cron error", { error: getErrorMessage(err) });
		}
	};

	const initial = setTimeout(tick, 60_000); // run 1 min after boot
	const interval = setInterval(tick, INTERVAL_MS);

	return () => {
		clearTimeout(initial);
		clearInterval(interval);
	};
}

async function suspendExpiredTrials(): Promise<void> {
	const db = getDb();
	const expired = await listExpiredTrials(db);
	if (expired.length === 0) return;

	logger.info("Suspending expired tenants", { count: expired.length });

	// Import lazily so the worker doesn't require PROVISIONER_URL at startup
	// if there are no tenants to action. Keeps OSS boot cheap.
	const { suspendTenant } = await import("./provisioner-rpc.ts");

	for (const tenant of expired) {
		try {
			await suspendTenant(tenant.slug);
			await setTenantStatus(db, tenant.slug, "suspended");
			logger.info("Tenant suspended (trial expired)", {
				slug: tenant.slug,
				trialEndsAt: tenant.trial_ends_at,
			});
		} catch (err) {
			logger.error("Failed to suspend expired trial", {
				slug: tenant.slug,
				error: getErrorMessage(err),
			});
		}
	}
}

async function purgeOldSuspended(): Promise<void> {
	const db = getDb();
	const cutoff = new Date(Date.now() - DELETE_AFTER_MS);
	const candidates = await listSuspendedOlderThan(db, cutoff);
	if (candidates.length === 0) return;

	logger.info("Purging long-suspended tenants", { count: candidates.length });

	const { teardownTenant } = await import("./provisioner-rpc.ts");

	for (const tenant of candidates) {
		try {
			await teardownTenant(tenant.slug, true);
			await setTenantStatus(db, tenant.slug, "deleted");
			logger.info("Tenant purged (30d after suspension)", {
				slug: tenant.slug,
				suspendedAt: tenant.suspended_at,
			});
		} catch (err) {
			logger.error("Failed to purge suspended tenant", {
				slug: tenant.slug,
				error: getErrorMessage(err),
			});
		}
	}
}
