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
	const active = await listTenantsByStatus(db, "active");
	if (active.length === 0) return;

	for (const tenant of active) {
		try {
			const status = await getTenantStatus(tenant.slug, tenant.plan);
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

			if (
				tenant.storage_limit_mb > 0 &&
				storage.sizeMb > (tenant.storage_limit_mb * STORAGE_WARN_PCT) / 100
			) {
				logger.warn("Tenant storage over 80% of limit", {
					slug: tenant.slug,
					sizeMb: storage.sizeMb,
					limitMb: tenant.storage_limit_mb,
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
