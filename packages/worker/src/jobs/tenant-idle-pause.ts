/**
 * Hobby auto-pause cron.
 *
 * Every hour, suspend Hobby-tier tenants whose `last_active_at` is older
 * than IDLE_DAYS. Activity is written by:
 *   - tenant API middleware on successful 2xx responses
 *   - workflow-runner when a run transitions to `running`
 *
 * Platform-mode only. In oss/dedicated modes there's no tenant control
 * plane to enumerate against.
 *
 * Sprint-A note: this cron ships wired up but matches zero rows until
 * Sprint B adds `plan = 'hobby'`. Scaffolding it now means the pause
 * mechanic is in place the moment the first Hobby tenant is provisioned.
 */

import { getErrorMessage, logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import { listIdleHobbyTenants } from "@secondlayer/shared/db/queries/tenants";
import { getInstanceMode } from "@secondlayer/shared/mode";
import { suspendTenant } from "./provisioner-rpc.ts";

const INTERVAL_MS = 60 * 60 * 1000; // hourly
const IDLE_DAYS = 7;

export function startTenantIdlePauseCron(): () => void {
	if (getInstanceMode() !== "platform") {
		logger.info("Tenant idle-pause cron skipped (not platform mode)");
		return () => {};
	}

	const tick = async () => {
		try {
			await pauseIdle();
		} catch (err) {
			logger.error("Tenant idle-pause cron error", {
				error: getErrorMessage(err),
			});
		}
	};

	// Offset from the health cron's 45s boot so we don't hammer the DB
	// simultaneously on worker start.
	const initial = setTimeout(tick, 90_000);
	const interval = setInterval(tick, INTERVAL_MS);

	return () => {
		clearTimeout(initial);
		clearInterval(interval);
	};
}

async function pauseIdle(): Promise<void> {
	const db = getDb();
	const idleSince = new Date(Date.now() - IDLE_DAYS * 24 * 60 * 60 * 1000);
	const idle = await listIdleHobbyTenants(db, idleSince);
	if (idle.length === 0) return;

	for (const tenant of idle) {
		try {
			logger.info("Pausing idle Hobby tenant", {
				slug: tenant.slug,
				idleSince: idleSince.toISOString(),
			});
			await suspendTenant(tenant.slug);
		} catch (err) {
			logger.warn("Failed to pause idle tenant", {
				slug: tenant.slug,
				error: getErrorMessage(err),
			});
		}
	}
}
