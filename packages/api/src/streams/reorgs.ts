import {
	type ChainReorgCursor,
	type ChainReorgRecord,
	type ChainReorgTimeCursor,
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
	since: ChainReorgTimeCursor | ChainReorgCursor;
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
		throw new ValidationError("limit must be a positive integer");
	}
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed === 0) {
		throw new ValidationError("limit must be a positive integer");
	}
	return Math.min(1000, parsed);
}

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `next_since` resume token: `<detected_at>~<id>`. The timestamp is carried
 *  as raw text end-to-end (never through a JS Date, which truncates Postgres
 *  microseconds and would re-match the row the cursor came from); the id
 *  tiebreak guarantees a delivered reorg can never be re-delivered. */
export function encodeReorgsNextSince(reorg: StreamsReorg): string {
	return `${reorg.detected_at}~${reorg.id}`;
}

export function parseReorgsSince(
	value: string | null,
): ChainReorgTimeCursor | ChainReorgCursor {
	if (!value) {
		throw new ValidationError("since is required");
	}

	try {
		return decodeStreamsCursor(value);
	} catch {}

	const tilde = value.indexOf("~");
	const detectedAt = tilde === -1 ? value : value.slice(0, tilde);
	const id = tilde === -1 ? null : value.slice(tilde + 1);

	if (Number.isNaN(new Date(detectedAt).getTime())) {
		throw new ValidationError("since must be an ISO timestamp or cursor");
	}
	if (id !== null && !UUID_RE.test(id)) {
		throw new ValidationError("since cursor id must be a UUID");
	}
	return { detected_at: detectedAt, id };
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
	const last = reorgs.at(-1);

	return {
		reorgs,
		next_since: last ? encodeReorgsNextSince(last) : null,
	};
}
