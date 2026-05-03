/**
 * Legacy tenant idle-pause cron.
 *
 * Hobby was removed; keep the exported starter as a no-op for worker
 * bootstrap compatibility.
 */

import { logger } from "@secondlayer/shared";

export function startTenantIdlePauseCron(): () => void {
	logger.info("Tenant idle-pause cron skipped (Hobby removed)");
	return () => {};
}
