import { Cursor } from "./cursor.ts";
import type {
	ConsumerBatchContext,
	StreamsBatch,
	StreamsEvent,
	StreamsEventType,
	StreamsEventsEnvelope,
	StreamsFilterValue,
	StreamsReorg,
} from "./types.ts";

/** Stable identity of a reorg, for in-memory dedup across re-reported pages. */
function reorgKey(reorg: StreamsReorg): string {
	return `${reorg.detected_at}|${reorg.fork_point_height}|${reorg.new_canonical_tip}`;
}

type StreamsEventsFetchParams = {
	cursor?: string | null;
	limit: number;
	types?: readonly StreamsEventType[];
	notTypes?: readonly StreamsEventType[];
	contractId?: StreamsFilterValue;
	sender?: StreamsFilterValue;
	recipient?: StreamsFilterValue;
	assetIdentifier?: string;
};

export type StreamsEventsFetcher = (
	params: StreamsEventsFetchParams,
) => Promise<StreamsEventsEnvelope>;

export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

/** Build the ctx handed to `onBatch`. Shared by the Streams and Index loops so
 *  the two can't drift on what "progress" means. */
export function batchContext(
	cursor: string | null,
	height: number | null,
	tipHeight: number,
): ConsumerBatchContext {
	return {
		cursor,
		height,
		tipHeight,
		blocksBehind: height === null ? null : Math.max(0, tipHeight - height),
	};
}

export async function defaultSleep(
	ms: number,
	signal?: AbortSignal,
): Promise<void> {
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
	mode?: "tail" | "bounded";
	finalizedOnly?: boolean;
	batchSize: number;
	types?: readonly StreamsEventType[];
	notTypes?: readonly StreamsEventType[];
	contractId?: StreamsFilterValue;
	sender?: StreamsFilterValue;
	recipient?: StreamsFilterValue;
	assetIdentifier?: string;
	fetchEvents: StreamsEventsFetcher;
	onBatch: (
		events: StreamsEvent[],
		envelope: StreamsEventsEnvelope,
		ctx: ConsumerBatchContext,
	) =>
		| void
		| string
		| null
		| undefined
		| Promise<void>
		| Promise<string | null | undefined>;
	onReorg?: (
		reorg: StreamsReorg,
		ctx: { cursor: string },
	) => Promise<void> | void;
	sleep?: Sleep;
	emptyBackoffMs?: number;
	maxPages?: number;
	maxEmptyPolls?: number;
	signal?: AbortSignal;
}): Promise<{ cursor: string | null; pages: number; emptyPolls: number }> {
	const sleep = opts.sleep ?? defaultSleep;
	const mode = opts.mode ?? "tail";
	const finalizedOnly = opts.finalizedOnly ?? false;
	const emptyBackoffMs = opts.emptyBackoffMs ?? 500;
	const maxPages = opts.maxPages ?? Number.POSITIVE_INFINITY;
	const maxEmptyPolls = opts.maxEmptyPolls ?? Number.POSITIVE_INFINITY;
	let cursor = opts.fromCursor ?? null;
	// In-memory only: rollback is idempotent, so a crash before the rewind is
	// re-detected and re-applied harmlessly on restart — no need to persist.
	const handledReorgs = new Set<string>();
	let pages = 0;
	let emptyPolls = 0;
	// Highest block reached, carried across empty pages so a caught-up tail
	// keeps reporting its position instead of dropping to null.
	let height: number | null = null;

	while (
		pages < maxPages &&
		emptyPolls < maxEmptyPolls &&
		!opts.signal?.aborted
	) {
		const envelope = await opts.fetchEvents({
			cursor,
			limit: opts.batchSize,
			types: opts.types,
			notTypes: opts.notTypes,
			contractId: opts.contractId,
			sender: opts.sender,
			recipient: opts.recipient,
			assetIdentifier: opts.assetIdentifier,
		});
		pages++;

		// Reorgs: roll back each new fork, then rewind to the lowest fork point
		// and re-read the now-canonical run. Finalized data never reorgs, so
		// `finalizedOnly` skips this entirely.
		if (!finalizedOnly && opts.onReorg) {
			const fresh = envelope.reorgs
				.filter((reorg) => !handledReorgs.has(reorgKey(reorg)))
				.sort((a, b) => a.fork_point_height - b.fork_point_height);
			if (fresh.length > 0) {
				const forkPoint = Math.min(
					...fresh.map((reorg) => reorg.fork_point_height),
				);
				const rewind = Cursor.atHeight(forkPoint);
				for (const reorg of fresh) {
					await opts.onReorg(reorg, { cursor: rewind });
					handledReorgs.add(reorgKey(reorg));
				}
				cursor = rewind;
				// Everything at and above the fork is no longer canonical, so the
				// reached height rolls back with it.
				height = forkPoint > 0 ? forkPoint - 1 : null;
				emptyPolls = 0;
				continue;
			}
		}

		const emitted = finalizedOnly
			? envelope.events.filter((event) => event.finalized)
			: envelope.events;
		// Only advance to the last finalized event in finalizedOnly mode; the
		// unfinalized tail is re-read next poll until it settles.
		const checkpoint = finalizedOnly
			? (emitted.at(-1)?.cursor ?? cursor)
			: envelope.next_cursor;
		// Ascending cursor order, so the last row is the highest block this page
		// reached; an empty page keeps the previous value.
		height = emitted.at(-1)?.block_height ?? height;

		const returnedCursor = await opts.onBatch(
			emitted,
			envelope,
			batchContext(checkpoint, height, envelope.tip.block_height),
		);
		const nextCursor = returnedCursor ?? checkpoint;

		if (nextCursor && nextCursor !== cursor) {
			cursor = nextCursor;
			emptyPolls = 0;
			continue;
		}

		if (emitted.length === 0) {
			emptyPolls++;
			if (mode === "bounded") {
				return { cursor, pages, emptyPolls };
			}
			await sleep(emptyBackoffMs, opts.signal);
			continue;
		}

		return { cursor, pages, emptyPolls };
	}

	return { cursor, pages, emptyPolls };
}

/**
 * Async-iterator form of the Streams pull loop, yielding one {@link StreamsBatch}
 * per fetched page. Each yield maps 1:1 onto a `GET /v1/streams/events` envelope
 * (`{ events, next_cursor, tip, reorgs }` → `{ events, cursor, tip, reorgs }`) —
 * no extra API calls, no regrouping. Pages with no events and no reorgs are not
 * yielded; the iterator sleeps `intervalMs` and re-polls the tip instead.
 */
export async function* iterateStreamsBatches(opts: {
	fromCursor?: string | null;
	batchSize: number;
	intervalMs: number;
	types?: readonly StreamsEventType[];
	notTypes?: readonly StreamsEventType[];
	contractId?: StreamsFilterValue;
	sender?: StreamsFilterValue;
	recipient?: StreamsFilterValue;
	assetIdentifier?: string;
	fetchEvents: StreamsEventsFetcher;
	sleep?: Sleep;
	signal?: AbortSignal;
}): AsyncGenerator<StreamsBatch> {
	const sleep = opts.sleep ?? defaultSleep;
	let cursor = opts.fromCursor ?? null;

	while (!opts.signal?.aborted) {
		const envelope = await opts.fetchEvents({
			cursor,
			limit: opts.batchSize,
			types: opts.types,
			notTypes: opts.notTypes,
			contractId: opts.contractId,
			sender: opts.sender,
			recipient: opts.recipient,
			assetIdentifier: opts.assetIdentifier,
		});

		const checkpoint = envelope.next_cursor ?? cursor;
		if (envelope.events.length > 0 || envelope.reorgs.length > 0) {
			yield {
				events: envelope.events,
				cursor: checkpoint,
				tip: envelope.tip,
				reorgs: envelope.reorgs,
			};
		}

		const advanced = checkpoint !== null && checkpoint !== cursor;
		cursor = checkpoint;
		// Caught up at the tip: wait one poll interval before re-reading.
		if (!advanced && envelope.events.length === 0) {
			if (opts.signal?.aborted) return;
			await sleep(opts.intervalMs, opts.signal);
		}
	}
}

export async function* streamStreamsEvents(opts: {
	fromCursor?: string | null;
	batchSize: number;
	types?: readonly StreamsEventType[];
	notTypes?: readonly StreamsEventType[];
	contractId?: StreamsFilterValue;
	sender?: StreamsFilterValue;
	recipient?: StreamsFilterValue;
	assetIdentifier?: string;
	fetchEvents: StreamsEventsFetcher;
	sleep?: Sleep;
	emptyBackoffMs?: number;
	maxPages?: number;
	maxEmptyPolls?: number;
	signal?: AbortSignal;
}): AsyncGenerator<StreamsEvent> {
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
			notTypes: opts.notTypes,
			contractId: opts.contractId,
			sender: opts.sender,
			recipient: opts.recipient,
			assetIdentifier: opts.assetIdentifier,
		});
		pages++;

		for (const event of envelope.events) {
			if (opts.signal?.aborted) return;
			yield event;
		}

		const nextCursor = envelope.next_cursor;
		if (nextCursor && nextCursor !== cursor) {
			cursor = nextCursor;
			emptyPolls = 0;
			continue;
		}

		if (envelope.events.length === 0) {
			emptyPolls++;
			if (emptyPolls >= maxEmptyPolls || pages >= maxPages) return;
			await sleep(emptyBackoffMs, opts.signal);
			continue;
		}

		return;
	}
}
