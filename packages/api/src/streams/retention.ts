import { AuthorizationError, ValidationError } from "@secondlayer/shared/errors";
import type { MiddlewareHandler } from "hono";
import { decodeStreamsCursor } from "./cursor.ts";
import type { StreamsEnv } from "./auth.ts";
import { getStreamsRetentionCutoff, STREAMS_TIER_CONFIG } from "./tiers.ts";
import type { StreamsTipProvider } from "./tip.ts";

function parseBlockHeight(value: string, name: string): number {
	if (!/^(0|[1-9]\d*)$/.test(value)) {
		throw new ValidationError(`${name} must be a non-negative integer`);
	}

	const height = Number(value);
	if (!Number.isSafeInteger(height)) {
		throw new ValidationError(`${name} must be a non-negative integer`);
	}

	return height;
}

function parseCursorBlockHeight(cursor: string): number {
	try {
		return decodeStreamsCursor(cursor).block_height;
	} catch {
		throw new ValidationError("cursor must use <block_height>:<event_index>");
	}
}

export function streamsRetentionWindow(opts: {
	getTip: StreamsTipProvider;
}): MiddlewareHandler<StreamsEnv> {
	return async (c, next) => {
		const tenant = c.get("streamsTenant");
		const retentionDays = STREAMS_TIER_CONFIG[tenant.tier].retentionDays;

		if (retentionDays === null) {
			c.set("streamsTip", await opts.getTip());
			await next();
			return;
		}

		const tip = await opts.getTip();
		c.set("streamsTip", tip);

		const cursor = c.req.query("cursor");
		// TODO(PRD 0001): deprecate one of from_block/from_height or document both.
		const fromHeightParam =
			c.req.query("from_height") !== undefined ? "from_height" : "from_block";
		const fromHeight = c.req.query(fromHeightParam);
		const requestedHeight = cursor
			? parseCursorBlockHeight(cursor)
			: fromHeight
				? parseBlockHeight(fromHeight, fromHeightParam)
				: null;

		if (requestedHeight !== null) {
			const cutoff = getStreamsRetentionCutoff(tenant.tier, tip.block_height);
			if (cutoff !== null && requestedHeight < cutoff) {
				throw new AuthorizationError(
					`${tenant.tier} tier can read only the last ${retentionDays} days of Stacks Streams data`,
				);
			}
		}

		await next();
	};
}
