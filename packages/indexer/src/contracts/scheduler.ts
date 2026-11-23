import { getSourceDb } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import { StacksNodeClient } from "@secondlayer/shared/node/client";
import { discoverDeploys, processPendingAbis } from "./registry.ts";

const DEFAULT_INTERVAL_MS = 30_000;

export const contractRegistryState = {
	enabled: false,
	discoveredTotal: 0,
	classifiedTotal: 0,
	failedTotal: 0,
	lastRunAt: 0,
	lastError: null as string | null,
};

export function startContractRegistry(): () => void {
	const enabled = process.env.CONTRACT_REGISTRY_ENABLED === "true";
	contractRegistryState.enabled = enabled;
	if (!enabled) {
		logger.info(
			"Contract registry worker disabled (set CONTRACT_REGISTRY_ENABLED=true)",
		);
		return () => {};
	}

	const intervalMs = Number.parseInt(
		process.env.CONTRACT_REGISTRY_INTERVAL_MS ?? String(DEFAULT_INTERVAL_MS),
		10,
	);
	const discoverLimit = 500;
	const abiLimit = 25;
	const node = new StacksNodeClient();

	let running = false;
	const tick = async () => {
		if (running) return;
		running = true;
		try {
			const db = getSourceDb();
			const discovered = await discoverDeploys(db, { limit: discoverLimit });
			const { fetched, failed } = await processPendingAbis(db, node, {
				limit: abiLimit,
			});
			contractRegistryState.discoveredTotal += discovered;
			contractRegistryState.classifiedTotal += fetched;
			contractRegistryState.failedTotal += failed;
			contractRegistryState.lastRunAt = Date.now();
			contractRegistryState.lastError = null;
			if (discovered || fetched || failed) {
				logger.info("Contract registry tick", { discovered, fetched, failed });
			}
		} catch (err) {
			contractRegistryState.lastError =
				err instanceof Error ? err.message : String(err);
			logger.error("Contract registry tick failed", {
				error: contractRegistryState.lastError,
			});
		} finally {
			running = false;
		}
	};

	const initial = setTimeout(tick, 2_000);
	const interval = setInterval(tick, intervalMs);
	logger.info("Contract registry worker started", { intervalMs });
	return () => {
		clearTimeout(initial);
		clearInterval(interval);
	};
}
