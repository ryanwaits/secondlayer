import type { ConsumerSink, WithSinkTx } from "../sinks/types.ts";
import { Cursor } from "./cursor.ts";
import { ValidationError } from "./errors.ts";
import type {
	ConsumerBatchContext,
	StreamsBatch,
	StreamsEvent,
	StreamsEventType,
	StreamsEventsEnvelope,
	StreamsFilterMap,
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
	/** Labelled filter groups, forwarded to the server verbatim. */
	filters?: StreamsFilterMap;
};

export type StreamsEventsFetcher = (
	params: StreamsEventsFetchParams,
) => Promise<StreamsEventsEnvelope>;

export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

/**
 * Guard the `finalizedOnly` checkpoint contract. Shared by both loops.
 *
 * In `finalizedOnly` mode the unfinalized tail is filtered OUT of the batch
 * and re-read next poll — and `onReorg` is skipped entirely, so nothing ever
 * re-reads a range the cursor has passed. Returning a cursor above the last
 * delivered finalized event (e.g. `envelope.next_cursor`, which points past
 * the filtered tail) therefore drops those events permanently and silently.
 * Throw instead: this is the one wrong return the loop can detect.
 */
export function assertFinalizedCheckpoint(
	// biome-ignore lint/suspicious/noConfusingVoidType: mirrors the onBatch return union it validates
	returned: string | null | undefined | void,
	checkpoint: string | null,
): void {
	if (returned === null || returned === undefined) return;
	if (returned === checkpoint) return;
	const r = Cursor.parse(returned);
	const c = checkpoint === null ? null : Cursor.parse(checkpoint);
	const above =
		c === null ||
		r.blockHeight > c.blockHeight ||
		(r.blockHeight === c.blockHeight && r.eventIndex > c.eventIndex);
	if (above) {
		const boundary = c ? ` ("${checkpoint}")` : " (none delivered yet)";
		throw new ValidationError(
			`onBatch returned cursor "${returned}", above the last delivered finalized event${boundary}. With finalizedOnly, events past that point were filtered out and will be re-read once finalized — committing beyond it skips them permanently. Return ctx.cursor (or nothing); never envelope.next_cursor.`,
			400,
		);
	}
}

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

/** Options shared by both consume loops' page-fetch retry. Vocabulary matches
 *  `@secondlayer/stacks` transports (`retryCount`/`retryDelay`) — one retry
 *  language across the family, not a third. */
export type PageRetryOptions = {
	/** Retries after the first failure. Default 3; `0` disables. */
	retryCount?: number;
	/** Base delay in ms; the n-th retry waits `retryDelay * n` (matches the
	 *  stacks transport). A server `Retry-After` overrides it. Default 1000. */
	retryDelay?: number;
	/** Void observer, called before each retry sleep (metrics/logging). The
	 *  retry policy owns the decision; this cannot change it. */
	onError?: (
		err: unknown,
		ctx: { attempt: number; retriesLeft: number; delayMs: number },
	) => void;
};

/** Retry-After above this is treated as "give up now, resume later". */
const MAX_RETRY_AFTER_MS = 300_000;

function errRetryable(err: unknown): boolean {
	// SecondLayerError family carries an explicit signal; a bare TypeError is
	// the raw fetch network failure (Streams' fetchImpl isn't wrapped).
	if (err && typeof err === "object" && "retryable" in err) {
		return (err as { retryable: unknown }).retryable === true;
	}
	return err instanceof TypeError;
}

function errRetryAfterMs(err: unknown): number | undefined {
	if (err && typeof err === "object" && "retryAfterSeconds" in err) {
		const seconds = (err as { retryAfterSeconds: unknown }).retryAfterSeconds;
		if (typeof seconds === "number" && Number.isFinite(seconds)) {
			return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
		}
	}
	return undefined;
}

/**
 * Run one page fetch with retries. Scoped to the FETCH only — never the loop
 * body: retrying after an `onReorg`/`onBatch` throw would re-enter with
 * `handledReorgs` partially mutated and skip a rollback silently. `onBatch`
 * and `onReorg` throws always propagate to the caller.
 */
export async function fetchPageWithRetry<T>(
	fetchPage: () => Promise<T>,
	opts: PageRetryOptions & { sleep: Sleep; signal?: AbortSignal },
): Promise<T> {
	const retryCount = opts.retryCount ?? 3;
	const retryDelay = opts.retryDelay ?? 1000;
	for (let attempt = 0; ; attempt++) {
		try {
			return await fetchPage();
		} catch (err) {
			const retriesLeft = retryCount - attempt;
			if (retriesLeft <= 0 || !errRetryable(err) || opts.signal?.aborted) {
				throw err;
			}
			const delayMs = errRetryAfterMs(err) ?? retryDelay * (attempt + 1);
			opts.onError?.(err, { attempt, retriesLeft, delayMs });
			await opts.sleep(delayMs, opts.signal);
			// Aborted mid-sleep: surface the original failure, not a fresh fetch.
			if (opts.signal?.aborted) throw err;
		}
	}
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

export async function consumeStreamsEvents<TTx = never>(opts: {
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
	/** Labelled filter groups, forwarded to the server verbatim. */
	filters?: StreamsFilterMap;
	fetchEvents: StreamsEventsFetcher;
	/** Destination adapter owning checkpoint + rollback (see IndexConsumeOptions.sink). */
	sink?: ConsumerSink<TTx>;
	/** Fires once per page, before `onBatch` and any early return. */
	onProgress?: (ctx: ConsumerBatchContext) => void;
	onBatch: (
		events: StreamsEvent[],
		envelope: StreamsEventsEnvelope,
		ctx: ConsumerBatchContext & WithSinkTx<TTx>,
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
	retryCount?: number;
	retryDelay?: number;
	onError?: PageRetryOptions["onError"];
	signal?: AbortSignal;
}): Promise<{ cursor: string | null; pages: number; emptyPolls: number }> {
	const sleep = opts.sleep ?? defaultSleep;
	const mode = opts.mode ?? "tail";
	const finalizedOnly = opts.finalizedOnly ?? false;
	const emptyBackoffMs = opts.emptyBackoffMs ?? 500;
	const maxPages = opts.maxPages ?? Number.POSITIVE_INFINITY;
	const maxEmptyPolls = opts.maxEmptyPolls ?? Number.POSITIVE_INFINITY;
	// Resume order: explicit fromCursor, then the sink's committed checkpoint.
	let cursor = opts.fromCursor ?? (await opts.sink?.loadCursor()) ?? null;
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
		// Retry wraps ONLY the page fetch: one transient 429/5xx must not kill
		// an hours-long backfill, and handler throws must never be re-entered.
		const envelope = await fetchPageWithRetry(
			() =>
				opts.fetchEvents({
					cursor,
					limit: opts.batchSize,
					types: opts.types,
					notTypes: opts.notTypes,
					contractId: opts.contractId,
					sender: opts.sender,
					recipient: opts.recipient,
					assetIdentifier: opts.assetIdentifier,
					filters: opts.filters,
				}),
			{
				retryCount: opts.retryCount,
				retryDelay: opts.retryDelay,
				onError: opts.onError,
				sleep,
				signal: opts.signal,
			},
		);
		pages++;

		// Reorgs: roll back each new fork, then rewind to the lowest fork point
		// and re-read the now-canonical run. Finalized data never reorgs, so
		// `finalizedOnly` skips this entirely. A sink makes rollback
		// UNCONDITIONAL — omitting `onReorg` used to skip reorgs silently.
		if (!finalizedOnly && (opts.onReorg || opts.sink)) {
			const fresh = envelope.reorgs
				.filter((reorg) => !handledReorgs.has(reorgKey(reorg)))
				.sort((a, b) => a.fork_point_height - b.fork_point_height);
			if (fresh.length > 0) {
				const forkPoint = Math.min(
					...fresh.map((reorg) => reorg.fork_point_height),
				);
				const rewind = Cursor.atHeight(forkPoint);
				for (const reorg of fresh) {
					await opts.sink?.rollback(reorg.fork_point_height, rewind);
					await opts.onReorg?.(reorg, { cursor: rewind });
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

		const ctx = batchContext(checkpoint, height, envelope.tip.block_height);
		// Before any early return: an empty page still proves the loop is alive.
		opts.onProgress?.(ctx);

		let nextCursor: string | null;
		if (opts.sink) {
			const sink = opts.sink;
			// Rows and cursor commit in ONE transaction; a handler throw aborts
			// both. Nothing moved → nothing to commit, handler not invoked.
			if (
				checkpoint !== null &&
				(checkpoint !== cursor || emitted.length > 0)
			) {
				await sink.commitBatch(checkpoint, async (tx) => {
					await opts.onBatch(emitted, envelope, {
						...ctx,
						tx,
					} as ConsumerBatchContext & WithSinkTx<TTx>);
				});
			}
			nextCursor = checkpoint;
		} else {
			const returnedCursor = await opts.onBatch(
				emitted,
				envelope,
				ctx as ConsumerBatchContext & WithSinkTx<TTx>,
			);
			if (finalizedOnly) assertFinalizedCheckpoint(returnedCursor, checkpoint);
			nextCursor = returnedCursor ?? checkpoint;
		}

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
	/** Labelled filter groups, forwarded to the server verbatim. */
	filters?: StreamsFilterMap;
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
			filters: opts.filters,
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
	/** Labelled filter groups, forwarded to the server verbatim. */
	filters?: StreamsFilterMap;
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
			filters: opts.filters,
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
