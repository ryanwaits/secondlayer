import type { StreamsEvent } from "../streams-events.ts";

export type StreamsTip = {
	block_height: number;
	index_block_hash: string;
	burn_block_height: number;
	lag_seconds: number;
};

export type StreamsEventsEnvelope = {
	events: StreamsEvent[];
	next_cursor: string | null;
	tip: StreamsTip;
	reorgs: unknown[];
};

export type StreamsEventsFetchParams = {
	cursor?: string | null;
	limit: number;
	types?: readonly string[];
};

export type StreamsEventsFetcher = (
	params: StreamsEventsFetchParams,
) => Promise<StreamsEventsEnvelope>;

export type Sleep = (ms: number) => Promise<void>;
export type FetchLike = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

function defaultInternalStreamsApiKey(): string {
	const apiKey = process.env.STREAMS_INTERNAL_API_KEY;
	if (apiKey) return apiKey;
	if (process.env.NODE_ENV === "production") {
		throw new Error("STREAMS_INTERNAL_API_KEY is required in production");
	}
	return "sk-sl_streams_enterprise_test";
}

export function createHttpStreamsEventsFetcher(opts?: {
	baseUrl?: string;
	apiKey?: string;
	fetchImpl?: FetchLike;
}): StreamsEventsFetcher {
	const baseUrl =
		opts?.baseUrl ?? process.env.STREAMS_API_URL ?? "http://127.0.0.1:3800";
	const apiKey = opts?.apiKey ?? defaultInternalStreamsApiKey();
	const fetchImpl = opts?.fetchImpl ?? ((input, init) => fetch(input, init));

	return async ({ cursor, limit, types }) => {
		const url = new URL("/v1/streams/events", baseUrl);
		url.searchParams.set("limit", String(limit));
		if (cursor) url.searchParams.set("cursor", cursor);
		if (types?.length) url.searchParams.set("types", types.join(","));

		const response = await fetchImpl(url, {
			headers: { Authorization: `Bearer ${apiKey}` },
		});
		if (!response.ok) {
			throw new Error(`Streams /events returned ${response.status}`);
		}

		return (await response.json()) as StreamsEventsEnvelope;
	};
}

export async function consumeStreamsEvents(opts: {
	fromCursor?: string | null;
	batchSize: number;
	types?: readonly string[];
	fetchEvents: StreamsEventsFetcher;
	onBatch: (
		events: StreamsEvent[],
		envelope: StreamsEventsEnvelope,
	) => Promise<string | null | undefined> | string | null | undefined;
	sleep?: Sleep;
	emptyBackoffMs?: number;
	maxPages?: number;
	maxEmptyPolls?: number;
}): Promise<{ cursor: string | null; pages: number; emptyPolls: number }> {
	const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
	const emptyBackoffMs = opts.emptyBackoffMs ?? 500;
	const maxPages = opts.maxPages ?? Number.POSITIVE_INFINITY;
	const maxEmptyPolls = opts.maxEmptyPolls ?? Number.POSITIVE_INFINITY;
	let cursor = opts.fromCursor ?? null;
	let pages = 0;
	let emptyPolls = 0;

	while (pages < maxPages && emptyPolls < maxEmptyPolls) {
		const envelope = await opts.fetchEvents({
			cursor,
			limit: opts.batchSize,
			types: opts.types,
		});
		pages++;

		const returnedCursor = await opts.onBatch(envelope.events, envelope);
		const nextCursor = returnedCursor ?? envelope.next_cursor;

		if (nextCursor && nextCursor !== cursor) {
			cursor = nextCursor;
			emptyPolls = 0;
			continue;
		}

		if (envelope.events.length === 0 && envelope.next_cursor === null) {
			emptyPolls++;
			await sleep(emptyBackoffMs);
			continue;
		}

		return { cursor, pages, emptyPolls };
	}

	return { cursor, pages, emptyPolls };
}
