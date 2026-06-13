import { PaymentRequiredError } from "@secondlayer/shared/errors";
import type { MiddlewareHandler } from "hono";
import { STREAMS_BLOCKS_PER_DAY } from "../streams/tiers.ts";
import { parseCursor, parseNonNegativeInteger } from "./_shared.ts";
import type { IndexEnv } from "./auth.ts";
import type { IndexTipProvider } from "./tip.ts";

/**
 * Free + keyless Index reads cover only the recent 24h window — the same
 * last-day default `parseIndexBaseQuery` already serves when no cursor /
 * from_height is given. Seeking deeper history is a paid/credited action, so a
 * free/anon caller that explicitly seeks below the window gets a 402. Paid
 * tiers (build/scale/enterprise) are unbounded.
 *
 * Mirrors the Streams retention gate (`streams/retention.ts`), but 402
 * (pay-to-unlock) rather than 403 — there's no separate cheaper-retention lane
 * for Index; history is simply a paid read. Point lookups (`/blocks/:id`,
 * `/transactions/:tx_id`) carry no cursor/from_height and are never gated.
 */
export const INDEX_FREE_WINDOW_BLOCKS = STREAMS_BLOCKS_PER_DAY;

export function indexFreeWindow(opts: {
	getTip: IndexTipProvider;
}): MiddlewareHandler<IndexEnv> {
	return async (c, next) => {
		const tier = c.get("indexTenant")?.tier; // undefined = anonymous / keyless
		// Paid tiers read all history; only free + anon are windowed.
		if (tier !== undefined && tier !== "free") return next();
		// An x402-paid call (per-call settle or prepaid-balance drawdown) already
		// paid for this read — let it through. The x402 middleware runs first and
		// sets `x402Payer` only on a paid call, never on the free-quota path.
		if (c.get("x402Payer" as never)) return next();

		const cursorRaw =
			c.req.query("from_cursor") ?? c.req.query("cursor") ?? undefined;
		const fromHeightRaw = c.req.query("from_height") ?? undefined;
		// No explicit backward seek → the route's own default 24h window applies.
		if (cursorRaw === undefined && fromHeightRaw === undefined) return next();

		let requested: number;
		try {
			requested = cursorRaw
				? parseCursor(cursorRaw).block_height
				: parseNonNegativeInteger(fromHeightRaw as string, "from_height");
		} catch {
			// Malformed params fall through to the route's own validation (400).
			return next();
		}

		const tip = await opts.getTip();
		c.set("indexTip", tip);
		const cutoff = Math.max(0, tip.block_height - INDEX_FREE_WINDOW_BLOCKS);
		if (requested < cutoff) {
			throw new PaymentRequiredError(
				"Free and keyless Index reads cover only the last 24 hours. Reading older history is a paid action.",
				{
					reason: "UPGRADE_REQUIRED",
					oldest_seekable_height: cutoff,
					oldest_cursor: `${cutoff}:0`,
					hint: "Add an API key on a paid plan, or top up usage credits, to read older history.",
				},
			);
		}
		return next();
	};
}
