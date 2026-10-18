/**
 * Hourly purge of OAuth rows for the hosted MCP: expired requests, codes and
 * tokens, dead grants, and clients that never got a token. The rules and the
 * lifetimes live in `@secondlayer/platform/db/queries/oauth`. No-op outside
 * platform mode.
 */

import { purgeOauth } from "@secondlayer/platform/db/queries/oauth";
import { getErrorMessage, logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import { getInstanceMode } from "@secondlayer/shared/mode";

const INTERVAL_MS = 60 * 60 * 1000;

export function startOauthPurgeCron(): () => void {
	if (getInstanceMode() !== "platform") {
		logger.info("OAuth purge cron skipped (not platform mode)");
		return () => {};
	}

	const tick = async () => {
		try {
			const deleted = await purgeOauth(getDb());
			if (deleted > 0) logger.info("Purged OAuth rows", { deleted });
		} catch (err) {
			logger.error("OAuth purge cron error", { error: getErrorMessage(err) });
		}
	};

	const initial = setTimeout(tick, 5 * 60_000);
	const interval = setInterval(tick, INTERVAL_MS);

	return () => {
		clearTimeout(initial);
		clearInterval(interval);
	};
}
