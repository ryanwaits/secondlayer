import type {
	StreamsEvent,
	StreamsEventsEnvelope,
	StreamsEventType,
} from "./types.ts";

type StreamsEventsFetchParams = {
	cursor?: string | null;
	limit: number;
	types?: readonly StreamsEventType[];
};

export type StreamsEventsFetcher = (
	params: StreamsEventsFetchParams,
) => Promise<StreamsEventsEnvelope>;

export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

export async function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) return;

	await new Promise<void>((resolve) => {
		const timeout = setTimeout(resolve, ms);
		if (!signal) return;
		signal.addEventListener(
			"abort",
			() => {
				clearTimeout(timeout);
				resolve();
			},
			{ once: true },
		);
	});
}

export async function consumeStreamsEvents(opts: {
	fromCursor?: string | null;
	batchSize: number;
	types?: readonly StreamsEventType[];
	fetchEvents: StreamsEventsFetcher;
	onBatch: (
		events: StreamsEvent[],
		envelope: StreamsEventsEnvelope,
	) => Promise<string | null | undefined> | string | null | undefined;
	sleep?: Sleep;
	emptyBackoffMs?: number;
	maxPages?: number;
	maxEmptyPolls?: number;
	signal?: AbortSignal;
}): Promise<{ cursor: string | null; pages: number; emptyPolls: number }> {
	const sleep = opts.sleep ?? defaultSleep;
	const emptyBackoffMs = opts.emptyBackoffMs ?? 500;
	const maxPages = opts.maxPages ?? Number.POSITIVE_INFINITY;
	const maxEmptyPolls = opts.maxEmptyPolls ?? Number.POSITIVE_INFINITY;
	let cursor = opts.fromCursor ?? null;
	let pages = 0;
	let emptyPolls = 0;

	while (
		pages < maxPages &&
		emptyPolls < maxEmptyPolls &&
		!opts.signal?.aborted
	) {
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

		if (envelope.events.length === 0) {
			emptyPolls++;
			await sleep(emptyBackoffMs, opts.signal);
			continue;
		}

		return { cursor, pages, emptyPolls };
	}

	return { cursor, pages, emptyPolls };
}

export async function* streamStreamsEvents(opts: {
	fromCursor?: string | null;
	batchSize: number;
	types?: readonly StreamsEventType[];
	fetchEvents: StreamsEventsFetcher;
	sleep?: Sleep;
	emptyBackoffMs?: number;
	signal?: AbortSignal;
}): AsyncGenerator<StreamsEvent> {
	const sleep = opts.sleep ?? defaultSleep;
	const emptyBackoffMs = opts.emptyBackoffMs ?? 500;
	let cursor = opts.fromCursor ?? null;

	while (!opts.signal?.aborted) {
		const envelope = await opts.fetchEvents({
			cursor,
			limit: opts.batchSize,
			types: opts.types,
		});

		for (const event of envelope.events) {
			if (opts.signal?.aborted) return;
			yield event;
		}

		const nextCursor = envelope.next_cursor;
		if (nextCursor && nextCursor !== cursor) {
			cursor = nextCursor;
			continue;
		}

		if (envelope.events.length === 0) {
			await sleep(emptyBackoffMs, opts.signal);
			continue;
		}
	}
}
