import { getErrorMessage } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import { measureStorage } from "@secondlayer/shared/db/queries/usage";
import { logger } from "@secondlayer/shared/logger";

const INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Start periodic storage measurement. Returns a cleanup function.
 */
export function startStorageMeasurement(): () => void {
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
