import { getDb, getSourceDb } from "@secondlayer/shared/db";
import { resolveChainTip } from "@secondlayer/shared/db/queries/integrity";
import { createInternalIndexHttpClient } from "@secondlayer/shared/index-http";
import { hasNoLocalChain } from "../subgraphs/hosted-source.ts";

const CHAIN_TIP_TTL_MS = 2_000;

/** The platform read sits on the dashboard's request path and its client
 *  retries without a timeout, so a slow platform must cost at most this much. */
const PLATFORM_TIP_TIMEOUT_MS = 500;

async function readPlatformTip(): Promise<number> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<number>((resolve) => {
		timer = setTimeout(() => resolve(0), PLATFORM_TIP_TIMEOUT_MS);
	});
	try {
		return await Promise.race([
			createInternalIndexHttpClient()
				.getIndexTip()
				.catch(() => 0),
			timeout,
		]);
	} finally {
		clearTimeout(timer);
	}
}

let chainTipCache: { value: number; fetchedAt: number } | null = null;

export function resetChainTipCache(): void {
	chainTipCache = null;
}

export async function getChainTip(now: number = Date.now()): Promise<number> {
	if (chainTipCache && now - chainTipCache.fetchedAt < CHAIN_TIP_TTL_MS) {
		return chainTipCache.value;
	}

	const seen = (db: ReturnType<typeof getDb>) =>
		resolveChainTip(db, "seen").catch(() => null);
	let value = (await seen(getSourceDb())) ?? (await seen(getDb())) ?? 0;

	// A hosted tenant has no indexer, so its own `index_progress` stays empty:
	// ask the platform's Index tip instead (same env contract and key as the
	// tenant's processors).
	if (value === 0 && (await hasNoLocalChain().catch(() => false))) {
		value = await readPlatformTip();
	}

	// A transient read failure/absence must not overwrite a previously known
	// tip with 0 — that would make every caller's `blocks_behind` jump to the
	// full chain height on a single blip in `index_progress`. The TTL still
	// restarts, so a source that stays empty is re-read once per window, not
	// on every request.
	if (value === 0 && chainTipCache) {
		chainTipCache = { value: chainTipCache.value, fetchedAt: now };
		return chainTipCache.value;
	}

	chainTipCache = { value, fetchedAt: now };
	return value;
}
