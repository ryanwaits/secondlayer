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
	StreamsReorgsListEnvelope,
} from "./types.ts";

/** Stable identity of a reorg, for in-memory dedup across re-reported pages. */
function reorgKey(reorg: StreamsReorg): string {
	return `${reorg.detected_at}|${reorg.fork_point_height}|${reorg.new_canonical_tip}`;
}

/** Default ceiling on how far below the checkpoint one reorg may rewind. */
export const DEFAULT_MAX_ROLLBACK_DEPTH = 1000;

/** What one call to {@link applyReorgs} did. `null` when nothing rewound. */
export type ReorgRewind = {
	/** Lowest fork point rolled back. */
	forkPoint: number;
	/** Cursor to resume from: the foot of `forkPoint`, or `null` (pre-genesis). */
	cursor: string | null;
};

/**
 * Apply a page's (or the reorg list's) reorgs against the consumer's position.
 * Shared by the Streams and Index loops so the two cannot drift on the one
 * rule that decides data loss: NEVER rewind forward.
 *
 * A reorg is only actionable when its fork point is at or below the height
 * the cursor has reached (`fork_point_height <= resumeHeight(cursor)`).
 * Servers attach every reorg whose orphaned span intersects the page span, so
 * a page read from below the fork carries a reorg the consumer has not
 * written past yet. Rewinding to it would move the cursor FORWARD and skip
 * every row between the checkpoint and the fork, durably once a sink commits
 * the rewound cursor. Those reorgs are marked handled and left alone: the
 * page itself is already the canonical chain.
 *
 * Every fresh reorg is validated BEFORE the sink sees any of them: the fork
 * point must be a non-negative safe integer, and the rewind may not reach
 * more than `maxRollbackDepth` blocks below the checkpoint unless the caller
 * raised the ceiling. `fork_point_height` drives a `DELETE ... >= fork` on
 * every declared table, so a malformed or hostile value is refused loudly
 * rather than executed.
 */
export async function applyReorgs<
	TReorg extends { fork_point_height: number },
>(opts: {
	reorgs: readonly TReorg[];
	cursor: string | null;
	/** In-memory dedup across re-reported pages; mutated. */
	handled: Set<string>;
	keyOf: (reorg: TReorg) => string;
	sink?: Pick<ConsumerSink<unknown>, "rollback">;
	onReorg?: (
		reorg: TReorg,
		ctx: { cursor: string | null },
	) => Promise<void> | void;
	maxRollbackDepth?: number;
}): Promise<ReorgRewind | null> {
	const fresh = opts.reorgs.filter(
		(reorg) => !opts.handled.has(opts.keyOf(reorg)),
	);
	if (fresh.length === 0) return null;

	for (const reorg of fresh) {
		const fork = reorg.fork_point_height;
		if (!Number.isSafeInteger(fork) || fork < 0) {
			throw new ValidationError(
				`Reorg fork_point_height ${String(fork)} is not a non-negative integer. Rollback deletes every row at or above the fork from every declared table, so a malformed fork point is refused before the sink runs.`,
				400,
			);
		}
	}

	const position = resumeHeight(opts.cursor);
	const applicable = fresh
		.filter((reorg) => position !== null && reorg.fork_point_height <= position)
		.sort((a, b) => a.fork_point_height - b.fork_point_height);
	// Fork above the checkpoint: nothing at or past it has been written, and
	// the page being read is already the new chain. Remember it, do not move.
	for (const reorg of fresh) {
		if (!applicable.includes(reorg)) opts.handled.add(opts.keyOf(reorg));
	}
	if (applicable.length === 0 || position === null) return null;

	const forkPoint = applicable[0]?.fork_point_height ?? position;
	const depth = position - forkPoint;
	const maxDepth = opts.maxRollbackDepth ?? DEFAULT_MAX_ROLLBACK_DEPTH;
	if (depth > maxDepth) {
		throw new ValidationError(
			`Reorg at fork ${forkPoint} rewinds ${depth} blocks below the checkpoint at height ${position}, past maxRollbackDepth (${maxDepth}). A rollback this deep deletes every row at or above the fork from every declared table. Confirm the source is trusted, then pass maxRollbackDepth: ${depth} or higher to allow it.`,
			400,
		);
	}

	const rewind = Cursor.atHeight(forkPoint);
	for (const reorg of applicable) {
		// Sink first: rollback + rewound cursor commit atomically. A user
		// onReorg (if any) runs after, for observability.
		await opts.sink?.rollback(reorg.fork_point_height, rewind);
		await opts.onReorg?.(reorg, { cursor: rewind });
		opts.handled.add(opts.keyOf(reorg));
	}
	return { forkPoint, cursor: rewind };
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

/**
 * Fail fast on an impossible sink/mode pairing. Shared by both loops, checked
 * BEFORE the first fetch and before `loadCursor`: a `finalizedOnly` sink
 * (append-only store — cannot undo committed rows) following the unfinalized
 * tip would corrupt on the first fork, and the corruption is silent until the
 * fork happens. Throwing at startup is the only loud moment available.
 */
export function assertSinkModeCompatible(
	sink: Pick<ConsumerSink, "capabilities"> | undefined,
	finalizedOnly: boolean,
): void {
	if (sink?.capabilities?.finalizedOnly && !finalizedOnly) {
		throw new ValidationError(
			"This sink declares capabilities.finalizedOnly — it cannot roll back reorged rows, and following the unfinalized tip would corrupt it at the first fork. Pass finalizedOnly: true to consume(), or use a sink that implements rollback.",
			400,
		);
	}
}

/**
 * The height a resume cursor implies — seeds the loop's "highest block
 * reached" so a consumer restarted into a quiet tail reports its true
 * position (`checkpoint`, `height`, `blocksBehind`) instead of `null`s
 * until the first delivered row. Lenient: an unparseable cursor seeds
 * nothing and is left for the server to reject.
 */
export function resumeHeight(cursor: string | null): number | null {
	if (cursor === null) return null;
	try {
		return Cursor.parse(cursor).blockHeight;
	} catch {
		return null;
	}
}

/** Build the ctx handed to `onBatch`. Shared by the Streams and Index loops so
 *  the two can't drift on what "progress" means. `blocksBehind` measures the
 *  consumer's BACKLOG (`tip - scannedHeight`), not the age of the last
 *  delivered event — a caught-up tail on a quiet contract is 0 behind. */
export function batchContext<TTip extends { block_height: number }, TReorg>(
	cursor: string | null,
	height: number | null,
	tip: TTip,
	reorgs: readonly TReorg[] = [],
	scannedHeight: number | null = null,
): ConsumerBatchContext<TTip, TReorg> {
	const tipHeight = tip.block_height;
	const position = scannedHeight ?? height;
	return {
		cursor,
		height,
		scannedHeight: position,
		tipHeight,
		blocksBehind: position === null ? null : Math.max(0, tipHeight - position),
		tip,
		reorgs,
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

/** Sleep clamp for a server `Retry-After`: the loop honors the header up to
 *  five minutes per attempt and keeps retrying within `retryCount`. It never
 *  gives up early on a long Retry-After; the tradeoff is a long wait, not a
 *  dropped loop. Set `retryCount: 0` to surface the 429 immediately instead. */
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
		const onAbort = () => {
			clearTimeout(timeout);
			resolve();
		};
		// Detach on the timer path too: a tail at the tip sleeps once per
		// empty poll, and each sleep that left its listener behind pinned a
		// closure on the caller's long-lived signal until the process exited.
		const timeout = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal?.addEventListener("abort", onAbort, { once: true });
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
	/** `GET /v1/streams/reorgs`, polled on idle (empty) pages so a reorg
	 *  that lands while the consumer sits at the tip is still rolled back.
	 *  Pages only carry reorgs overlapping their own span. */
	fetchReorgs?: (params: {
		since: string;
	}) => Promise<StreamsReorgsListEnvelope>;
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
		ctx: { cursor: string | null },
	) => Promise<void> | void;
	/** Deepest rewind one reorg may make below the checkpoint. Default 1000. */
	maxRollbackDepth?: number;
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
	assertSinkModeCompatible(opts.sink, finalizedOnly);
	// Resume order: explicit fromCursor, then the sink's committed checkpoint.
	// `loadCursor` is also the sink's INIT — it creates the checkpoint table and
	// validates the rollback precondition. Short-circuiting it on an explicit
	// `fromCursor` meant a replay-from-cursor run crashed on its first commit,
	// and skipped the height-column check that keeps reorg rollback from being
	// a silent no-op. Always initialize; `fromCursor` still wins as the resume
	// position.
	const committedCursor = (await opts.sink?.loadCursor()) ?? null;
	let cursor = opts.fromCursor ?? committedCursor;
	// In-memory only: rollback is idempotent, so a crash before the rewind is
	// re-detected and re-applied harmlessly on restart — no need to persist.
	const handledReorgs = new Set<string>();
	// Resume token for the idle-tip reorg list; `null` until the first idle
	// poll with a checkpoint to seed it from.
	let reorgSince: string | null = null;
	let pages = 0;
	let emptyPolls = 0;
	// Highest block reached, carried across empty pages so a caught-up tail
	// keeps reporting its position instead of dropping to null. Seeded from
	// the resume cursor: a restart into a quiet tail knows where it stands
	// before the first row lands.
	let height: number | null = resumeHeight(cursor);
	// Highest block VERIFIED — how far the sweep is actually caught up, as
	// opposed to `height` (last delivered row). Starts at the resume position;
	// each page moves it (see below).
	let scanned: number | null = height;

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

		// Reorgs: roll back each new fork at or below the checkpoint, then
		// rewind to the lowest fork point and re-read the now-canonical run.
		// Finalized data never reorgs, so `finalizedOnly` skips this entirely.
		// A sink makes rollback UNCONDITIONAL: omitting `onReorg` used to skip
		// reorgs silently.
		const reorgsOn = !finalizedOnly && Boolean(opts.onReorg || opts.sink);
		if (reorgsOn) {
			const rewound = await applyReorgs({
				reorgs: envelope.reorgs,
				cursor,
				handled: handledReorgs,
				keyOf: reorgKey,
				sink: opts.sink,
				onReorg: opts.onReorg,
				maxRollbackDepth: opts.maxRollbackDepth,
			});
			if (rewound) {
				cursor = rewound.cursor;
				// Everything at and above the fork is no longer canonical, so the
				// reached height rolls back with it — including the verified
				// position: the new chain above the fork is unread.
				height = rewound.forkPoint > 0 ? rewound.forkPoint - 1 : null;
				scanned = height;
				emptyPolls = 0;
				continue;
			}
		}

		// Idle tip: a page only reports reorgs overlapping its own span, so a
		// fork that lands while the consumer sits at the tip (orphaning rows
		// BELOW the next non-empty page) is never on a page. On an empty page
		// ask the reorg list instead: one extra request per idle poll. Seeded
		// from the checkpoint cursor (the API reads a cursor as "reorgs that
		// orphaned anything at or above this position"), then advanced by the
		// list's own `next_since` token.
		if (reorgsOn && opts.fetchReorgs && envelope.events.length === 0) {
			reorgSince ??= cursor;
			if (reorgSince !== null) {
				const since: string = reorgSince;
				const fetchReorgs = opts.fetchReorgs;
				const listed: StreamsReorgsListEnvelope = await fetchPageWithRetry(
					() => fetchReorgs({ since }),
					{
						retryCount: opts.retryCount,
						retryDelay: opts.retryDelay,
						onError: opts.onError,
						sleep,
						signal: opts.signal,
					},
				);
				if (listed.next_since !== null) reorgSince = listed.next_since;
				const rewound = await applyReorgs({
					reorgs: listed.reorgs,
					cursor,
					handled: handledReorgs,
					keyOf: reorgKey,
					sink: opts.sink,
					onReorg: opts.onReorg,
					maxRollbackDepth: opts.maxRollbackDepth,
				});
				if (rewound) {
					cursor = rewound.cursor;
					height = rewound.forkPoint > 0 ? rewound.forkPoint - 1 : null;
					scanned = height;
					emptyPolls = 0;
					continue;
				}
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
		// Verified position. Rows delivered → through the last row (the page
		// limit hides what's above it). Empty page with an ADVANCED cursor →
		// through that cursor only (a server may cap an expensive filtered
		// scan; claiming the tip would overstate). Truly empty page → the
		// server confirmed nothing matches up to the tip. Non-empty raw page
		// fully filtered (unfinalized tail) → position unchanged.
		if (emitted.length > 0) {
			scanned = height;
		} else if (checkpoint !== null && checkpoint !== cursor) {
			scanned = resumeHeight(checkpoint) ?? scanned;
		} else if (envelope.events.length === 0) {
			scanned = envelope.tip.block_height;
		}

		// An empty page reports the STANDING cursor, not null: the committed
		// checkpoint is still this consumer's position while it idles.
		const ctx = batchContext(
			checkpoint ?? cursor,
			height,
			envelope.tip,
			envelope.reorgs,
			scanned,
		);
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
					// The cast is sound exactly as far as the sink's own typing:
					// `sink: ConsumerSink<TTx>` binds TTx, and `tx` here is what its
					// commitBatch lends. Nothing verifies it at runtime — a sink whose
					// declared Tx lies about what it lends fails inside the handler.
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
