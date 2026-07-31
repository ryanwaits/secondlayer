import type { ConsumerSink, WithSinkTx } from "../sinks/types.ts";
import {
	type PageRetryOptions,
	type Sleep,
	assertFinalizedCheckpoint,
	assertSinkModeCompatible,
	batchContext,
	defaultSleep,
	fetchPageWithRetry,
	resumeHeight,
} from "../streams/consumer.ts";
import { Cursor } from "../streams/cursor.ts";
import type { ConsumerBatchContext } from "../streams/types.ts";
import type { IndexReorg, IndexTip } from "./client.ts";

/** Minimum shape a consumed Index row must expose. */
export type IndexFeedItem = { cursor: string; block_height: number };

/** Minimum envelope shape of a consumable Index feed page. */
export type IndexFeedEnvelope = {
	next_cursor: string | null;
	tip: IndexTip;
	reorgs: IndexReorg[];
};

/** One page fetch. `fromHeight` is only set on the first page of a fresh
 *  consume (no cursor yet) — cursor and from_height are mutually exclusive
 *  on the API. */
export type IndexFeedFetcher<TEnvelope extends IndexFeedEnvelope> = (params: {
	cursor: string | null;
	fromHeight?: number;
	limit: number;
}) => Promise<TEnvelope>;

/** Consumer options shared by `index.events.consume` and
 *  `index.contractCalls.consume`. Same contract as the Streams consumer:
 *  commit your writes inside `onBatch`, return the cursor you committed —
 *  or attach a `sink` and let it own checkpointing and rollback entirely. */
export type IndexConsumeOptions<
	TItem extends IndexFeedItem,
	TEnvelope extends IndexFeedEnvelope,
	TTx = never,
> = {
	/** Resume from a committed checkpoint. Without it (and without
	 *  `fromHeight`) the API serves only the recent default window. */
	fromCursor?: string | null;
	/** Start a fresh sweep at this height (e.g. `0` for genesis backfill).
	 *  Ignored once a cursor exists (including a sink's committed cursor). */
	fromHeight?: number;
	/** `tail` (default) keeps polling at the tip; `bounded` returns on the
	 *  first empty page. */
	mode?: "tail" | "bounded";
	/** Emit only rows at or below the tip's `finalized_height`; the
	 *  unfinalized tail is re-read each poll until it settles. Finalized data
	 *  never reorgs, so `onReorg` is skipped entirely. */
	finalizedOnly?: boolean;
	batchSize?: number;
	/**
	 * Destination adapter that owns the checkpoint + rollback transaction
	 * (e.g. `kyselySink` from `@secondlayer/sdk/sinks/kysely`). With a sink:
	 * the loop resumes from the sink's committed cursor, `onBatch` receives
	 * `ctx.tx` and must write ONLY through it (rows and cursor commit in one
	 * transaction — a throw aborts both), reorg rollback is automatic (no
	 * `onReorg` needed), and `onBatch`'s return value is ignored.
	 */
	sink?: ConsumerSink<TTx>;
	/** Fires once per page, before `onBatch` and before any early return —
	 *  an empty page still proves the loop is alive. Feed it to
	 *  `consumerHealth().record`. */
	onProgress?: (ctx: ConsumerBatchContext) => void;
	onBatch: (
		items: TItem[],
		envelope: TEnvelope,
		ctx: ConsumerBatchContext & WithSinkTx<TTx>,
	) =>
		| void
		| string
		| null
		| undefined
		| Promise<void>
		| Promise<string | null | undefined>;
	onReorg?: (
		reorg: IndexReorg,
		ctx: { cursor: string },
	) => Promise<void> | void;
	sleep?: Sleep;
	emptyBackoffMs?: number;
	maxPages?: number;
	maxEmptyPolls?: number;
	signal?: AbortSignal;
	/** Page-fetch retries after the first failure (429/5xx/network only —
	 *  4xx and handler throws always propagate). Default 3; `0` disables. */
	retryCount?: number;
	/** Base retry delay in ms; the n-th retry waits `retryDelay * n`. A server
	 *  `Retry-After` overrides it. Default 1000. */
	retryDelay?: number;
	/** Void observer, called before each retry sleep. Cannot change the retry
	 *  decision — the policy owns it. */
	onError?: PageRetryOptions["onError"];
};

/**
 * Checkpointed pull loop over a cursor-paginated Index feed — the Index port
 * of `consumeStreamsEvents`, sharing its contract: at-least-once delivery,
 * client-owned checkpoints (`onBatch` may return the cursor it committed),
 * and automatic reorg rewind to the lowest fresh fork point.
 *
 * Differs from Streams in how finality is read: Index rows carry no
 * per-event `finalized` flag, so `finalizedOnly` gates by
 * `block_height <= tip.finalized_height` instead.
 */
export async function consumeIndexFeed<
	TItem extends IndexFeedItem,
	TEnvelope extends IndexFeedEnvelope,
	TTx = never,
>(
	opts: IndexConsumeOptions<TItem, TEnvelope, TTx> & {
		fetchPage: IndexFeedFetcher<TEnvelope>;
		itemsOf: (envelope: TEnvelope) => TItem[];
	},
): Promise<{ cursor: string | null; pages: number; emptyPolls: number }> {
	const sleep = opts.sleep ?? defaultSleep;
	const mode = opts.mode ?? "tail";
	const finalizedOnly = opts.finalizedOnly ?? false;
	const batchSize = opts.batchSize ?? 200;
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
		// an hours-long backfill, and handler throws must never be re-entered
		// (retrying past a thrown onReorg would skip its rollback silently).
		const envelope = await fetchPageWithRetry(
			() =>
				opts.fetchPage({
					cursor,
					fromHeight: cursor === null ? opts.fromHeight : undefined,
					limit: batchSize,
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
				.filter((reorg) => !handledReorgs.has(reorg.id))
				.sort((a, b) => a.fork_point_height - b.fork_point_height);
			if (fresh.length > 0) {
				const forkPoint = Math.min(
					...fresh.map((reorg) => reorg.fork_point_height),
				);
				const rewind = Cursor.atHeight(forkPoint);
				for (const reorg of fresh) {
					// Sink first: rollback + rewound cursor commit atomically.
					// A user onReorg (if any) runs after, for observability.
					await opts.sink?.rollback(reorg.fork_point_height, rewind);
					await opts.onReorg?.(reorg, { cursor: rewind });
					handledReorgs.add(reorg.id);
				}
				cursor = rewind;
				// Everything at and above the fork is no longer canonical, so the
				// reached height rolls back with it — including the verified
				// position: the new chain above the fork is unread.
				height = forkPoint > 0 ? forkPoint - 1 : null;
				scanned = height;
				emptyPolls = 0;
				continue;
			}
		}

		const items = opts.itemsOf(envelope);
		const emitted = finalizedOnly
			? items.filter(
					(item) => item.block_height <= envelope.tip.finalized_height,
				)
			: items;
		// Only advance to the last finalized row in finalizedOnly mode; the
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
		// scan; claiming the tip would overstate). Truly empty → the server
		// confirmed nothing matches up to the boundary — the finalized height
		// in finalizedOnly mode (the unfinalized tail is deliberately unread),
		// the tip otherwise.
		if (emitted.length > 0) {
			scanned = height;
		} else if (checkpoint !== null && checkpoint !== cursor) {
			scanned = resumeHeight(checkpoint) ?? scanned;
		} else {
			scanned = finalizedOnly
				? envelope.tip.finalized_height
				: envelope.tip.block_height;
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
			// both, so the crashed batch is simply re-read on restart. When the
			// page moved nothing (same checkpoint, no rows) there is nothing to
			// commit and the handler is not invoked.
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
