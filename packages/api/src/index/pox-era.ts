import { getSourceDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import type { Kysely } from "kysely";

/** Resolves "has the pox-4 era ended?" — injectable so callers can test the
 *  era-dependent behavior without a database. */
export type Pox4EraClosedReader = () => Promise<boolean>;

/** How long a `false` answer is trusted. The era flips exactly once, at the
 *  epoch 4.0 activation, so a short memo is enough to keep the probe off the
 *  hot path without meaningfully delaying the transition. */
const OPEN_ERA_TTL_MS = 30_000;

type EraMemo = { closed: boolean; expiresAt: number };

let memo: EraMemo | null = null;

/**
 * True once any canonical pox-5 event exists — i.e. epoch 4.0 activated and
 * `pox4_calls` stopped accumulating. pox-5 is a boot contract that cannot emit
 * a print before the fork, so the existence of a single canonical row is an
 * exact, chain-math-free test that the pox-4 era is closed.
 *
 * Monotonic: never returns to false in a forward-running index.
 */
export async function readPox4EraClosed(
	db: Kysely<Database> = getSourceDb(),
): Promise<boolean> {
	const { rows } = await sql<{ closed: boolean }>`
		SELECT EXISTS (
			SELECT 1 FROM pox5_events WHERE canonical = true
		) AS closed
	`.execute(db);
	return rows[0]?.closed === true;
}

/**
 * Memoized wrapper used by the read paths. Caches `false` briefly and `true`
 * forever (the condition cannot regress in a forward-running index).
 *
 * Never throws: a failed probe resolves to `false`, degrading to the
 * pre-fork behavior rather than taking down the endpoints that call it.
 */
export async function isPox4EraClosed(opts?: {
	read?: Pox4EraClosedReader;
}): Promise<boolean> {
	if (memo && (memo.closed || memo.expiresAt > Date.now())) {
		return memo.closed;
	}
	const read = opts?.read ?? (() => readPox4EraClosed());
	let closed: boolean;
	try {
		closed = await read();
	} catch {
		closed = false;
	}
	memo = {
		closed,
		// `true` is permanent; `false` is re-probed after the TTL.
		expiresAt: closed ? Number.POSITIVE_INFINITY : Date.now() + OPEN_ERA_TTL_MS,
	};
	return closed;
}

/** Clear the memo so tests are not order-dependent. */
export function _resetPox4EraCacheForTests(): void {
	memo = null;
}
