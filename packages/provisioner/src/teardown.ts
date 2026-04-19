import { logger } from "@secondlayer/shared";
import { containerRemove, containerStop, volumeRemove } from "./docker.ts";
import { allContainerNames, volumeName as buildVolumeName } from "./names.ts";

export interface TeardownOptions {
	/**
	 * Remove the tenant data volume too. Defaults to `false` — preserves the
	 * volume for a configurable soft-delete window so recovery is possible.
	 * Control plane sets `true` once the retention period elapses.
	 */
	deleteVolume?: boolean;
}

/**
 * Stop + remove all tenant containers. Optionally also remove the data
 * volume. Best-effort — individual failures are logged but do not abort
 * the sweep.
 */
export async function teardownTenant(
	slug: string,
	opts: TeardownOptions = {},
): Promise<void> {
	logger.info("Tearing down tenant", {
		slug,
		deleteVolume: opts.deleteVolume ?? false,
	});

	for (const name of allContainerNames(slug)) {
		try {
			await containerStop(name, 15);
		} catch (err) {
			logger.warn("Failed to stop container", {
				slug,
				container: name,
				error: err instanceof Error ? err.message : String(err),
			});
		}
		try {
			await containerRemove(name);
		} catch (err) {
			logger.warn("Failed to remove container", {
				slug,
				container: name,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	if (opts.deleteVolume) {
		try {
			await volumeRemove(buildVolumeName(slug));
		} catch (err) {
			logger.warn("Failed to remove volume", {
				slug,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}
}
