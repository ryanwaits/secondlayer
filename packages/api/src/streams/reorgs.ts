import {
	type ChainReorgCursor,
	type ChainReorgRecord,
	readChainReorgsForRange,
	readChainReorgsSince,
} from "@secondlayer/shared/db/queries/chain-reorgs";
import { ValidationError } from "@secondlayer/shared/errors";
import { decodeStreamsCursor } from "./cursor.ts";

export type StreamsReorg = ChainReorgRecord;

export type StreamsReorgsReader = (range: {
	from: ChainReorgCursor;
	to: ChainReorgCursor;
}) => Promise<StreamsReorg[]>;

export type StreamsReorgsSinceReader = (params: {
	since: Date | ChainReorgCursor;
	limit: number;
}) => Promise<StreamsReorg[]>;

export type StreamsReorgsListResponse = {
	reorgs: StreamsReorg[];
	next_since: string | null;
};

export const EMPTY_STREAMS_REORGS_READER: StreamsReorgsReader = async () => [];

export const DEFAULT_STREAMS_REORGS_READER: StreamsReorgsReader = (range) =>
	readChainReorgsForRange(range);

export const DEFAULT_STREAMS_REORGS_SINCE_READER: StreamsReorgsSinceReader = (
	params,
) => readChainReorgsSince(params);

function parseLimit(value: string | undefined): number {
	if (value === undefined) return 100;
	if (!/^(0|[1-9]\d*)$/.test(value)) {
		throw new ValidationError("limit must be a non-negative integer");
	}
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed)) {
		throw new ValidationError("limit must be a non-negative integer");
	}
	return Math.min(1000, Math.max(1, parsed));
}

export function parseReorgsSince(
	value: string | null,
): Date | ChainReorgCursor {
	if (!value) {
		throw new ValidationError("since is required");
	}

	try {
		return decodeStreamsCursor(value);
	} catch {}

	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) {
		throw new ValidationError("since must be an ISO timestamp or cursor");
	}
	return parsed;
}

export async function getStreamsReorgsListResponse(opts: {
	query: URLSearchParams;
	readReorgsSince?: StreamsReorgsSinceReader;
}): Promise<StreamsReorgsListResponse> {
	const since = parseReorgsSince(opts.query.get("since"));
	const limit = parseLimit(opts.query.get("limit") ?? undefined);
	const readReorgsSince =
		opts.readReorgsSince ?? DEFAULT_STREAMS_REORGS_SINCE_READER;
	const reorgs = await readReorgsSince({ since, limit });

	return {
		reorgs,
		next_since: reorgs.at(-1)?.detected_at ?? null,
	};
}
