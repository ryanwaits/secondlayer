/**
 * Tenant health + storage cron.
 *
 * Every 2 minutes:
 *   1. For each active tenant, call provisioner's GET /tenants/:slug
 *   2. If any container is not running → mark tenant status=error, log
 *   3. Query storage via GET /tenants/:slug/storage, persist storage_used_mb
 *   4. When storage > 80% of limit, log a warning (alert plumbing TBD)
 *
 * Platform-mode only. OSS/dedicated don't have multi-tenant monitoring.
 */

import { getErrorMessage, logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import {
	bumpTenantActivity,
	getTenantCredentials,
	listTenantsByStatus,
	recordHealthCheck,
	recordMonthlyUsage,
	setTenantStatus,
} from "@secondlayer/shared/db/queries/tenants";
import { getInstanceMode } from "@secondlayer/shared/mode";
import { getTenantStatus, getTenantStorage } from "./provisioner-rpc.ts";

const INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const STORAGE_WARN_PCT = 80;
const STORAGE_PAUSE_PCT = 95;

export function startTenantHealthCron(): () => void {
	if (getInstanceMode() !== "platform") {
		logger.info("Tenant health cron skipped (not platform mode)");
		return () => {};
	}

	const tick = async () => {
		try {
			await checkAllTenants();
		} catch (err) {
			logger.error("Tenant health cron error", { error: getErrorMessage(err) });
		}
	};

	const initial = setTimeout(tick, 45_000); // 45s post-boot so worker finishes starting
	const interval = setInterval(tick, INTERVAL_MS);

	return () => {
		clearTimeout(initial);
		clearInterval(interval);
	};
}

async function checkAllTenants(): Promise<void> {
	const db = getDb();
	const tenants = [
		...(await listTenantsByStatus(db, "active")),
		...(await listTenantsByStatus(db, "limit_warning")),
	];
	if (tenants.length === 0) return;

	for (const tenant of tenants) {
		try {
			const status = await getTenantStatus(
				tenant.slug,
				tenant.plan,
				tenant.storage_limit_mb,
			);
			const unhealthy = status.containers.find(
				(c) => c.state !== "running" && c.state !== "restarting",
			);
			if (unhealthy) {
				logger.error("Tenant container unhealthy", {
					slug: tenant.slug,
					container: unhealthy.name,
					state: unhealthy.state,
				});
				await setTenantStatus(db, tenant.slug, "error");
				continue;
			}

			// Storage check — need the decrypted DB URL to query.
			const creds = await getTenantCredentials(db, tenant.slug);
			if (!creds) continue;
			const storage = await getTenantStorage(
				tenant.slug,
				creds.targetDatabaseUrl,
			);

			await recordHealthCheck(db, tenant.slug, storage.sizeMb);
			await recordMonthlyUsage(db, tenant.id, storage.sizeMb);

			// Activity heartbeat — the tenant API tracks lastRequestAt in-memory
			// and exposes it at /internal/activity. If it moved past our stored
			// `last_active_at`, bump. Best-effort: failures don't block health.
			try {
				const res = await fetch(`${tenant.api_url_internal}/internal/activity`);
				if (res.ok) {
					const { lastRequestAt } = (await res.json()) as {
						lastRequestAt: string | null;
					};
					if (
						lastRequestAt &&
						new Date(lastRequestAt) > tenant.last_active_at
					) {
						await bumpTenantActivity(db, tenant.slug);
					}
				}
			} catch (err) {
				logger.debug("Tenant activity fetch failed", {
					slug: tenant.slug,
					error: getErrorMessage(err),
				});
			}

			if (tenant.storage_limit_mb <= 0) {
				continue;
			}

			const usagePct = (storage.sizeMb / tenant.storage_limit_mb) * 100;
			if (usagePct >= STORAGE_PAUSE_PCT) {
				await setTenantStatus(db, tenant.slug, "paused_limit");
				logger.error("Tenant paused at storage limit", {
					slug: tenant.slug,
					sizeMb: storage.sizeMb,
					limitMb: tenant.storage_limit_mb,
					usagePct,
					action: "paused_limit",
				});
			} else if (usagePct >= STORAGE_WARN_PCT) {
				if (tenant.status !== "limit_warning") {
					await setTenantStatus(db, tenant.slug, "limit_warning");
				}
				logger.warn("Tenant storage near limit", {
					slug: tenant.slug,
					sizeMb: storage.sizeMb,
					limitMb: tenant.storage_limit_mb,
					usagePct,
					action: "limit_warning",
				});
			} else if (tenant.status === "limit_warning") {
				await setTenantStatus(db, tenant.slug, "active");
				logger.info("Tenant storage back under warning threshold", {
					slug: tenant.slug,
					sizeMb: storage.sizeMb,
					limitMb: tenant.storage_limit_mb,
					usagePct,
				});
			}
		} catch (err) {
			logger.warn("Tenant health check failed", {
				slug: tenant.slug,
				error: getErrorMessage(err),
			});
		}
	}
}
