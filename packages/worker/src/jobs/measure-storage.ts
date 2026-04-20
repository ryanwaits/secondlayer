import { getErrorMessage } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import { measureStorage } from "@secondlayer/shared/db/queries/usage";
import { logger } from "@secondlayer/shared/logger";
import { isPlatformMode } from "@secondlayer/shared/mode";

const INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Start periodic storage measurement. Returns a cleanup function.
 *
 * In platform mode there are no subgraphs on the control plane — per-tenant
 * storage is measured by the provisioner's `measureStorageMb` called from
 * the tenant-health cron. Skip here to avoid querying a `subgraphs` table
 * that doesn't exist on the platform DB post-cutover.
 */
export function startStorageMeasurement(): () => void {
	if (isPlatformMode()) {
		logger.info(
			"Skipping worker storage measurement — platform mode (per-tenant measurement runs via provisioner)",
		);
		return () => {};
	}

	const run = async () => {
		try {
			const db = getDb();
			await measureStorage(db);
			logger.info("Storage measurement complete");
		} catch (err) {
			logger.error("Storage measurement failed", {
				error: getErrorMessage(err),
			});
		}
	};

	// Run once on startup (delayed 30s to let services settle)
	const initialTimeout = setTimeout(run, 30_000);
	const interval = setInterval(run, INTERVAL_MS);

	return () => {
		clearTimeout(initialTimeout);
		clearInterval(interval);
	};
}
