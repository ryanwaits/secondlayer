import { cacheControl } from "../http/cache.ts";
import { parseIndexBaseQuery } from "./_shared.ts";
import type { IndexTip } from "./tip.ts";

export type IndexCachePlan = {
	cacheControl: string;
	/** True when the resolved page is past finality and safe to cache forever. */
	fullyFinalized: boolean;
};

/**
 * Cache directive for an Index read. Finality depends only on the shared base
 * query — the resolved height window and whether the cursor sits past the tip —
 * so this one helper serves every Index route (events, transfers, contract-calls
 * all spread `parseIndexBaseQuery`, and the contract-call cursor shares the
 * `height:n` shape, so the base parse resolves the same window).
 *
 * A page is immutable when its resolved `to_height` is at or below the finality
 * boundary and the cursor isn't past the tip; otherwise it can still reorg and
 * gets a short private TTL. Re-parses the query (pure, cheap) so routes need not
 * thread the resolved range through the response envelope — mirrors the Streams
 * cache plan.
 */
export function indexCachePlan(
	query: URLSearchParams,
	tip: IndexTip,
): IndexCachePlan {
	const base = parseIndexBaseQuery(query, tip);
	const fullyFinalized =
		!base.cursorPastTip && base.toHeight <= tip.finalized_height;
	return { cacheControl: cacheControl(fullyFinalized), fullyFinalized };
}
