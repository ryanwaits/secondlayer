import { type Sleep, defaultSleep } from "../streams/consumer.ts";
import { Cursor } from "../streams/cursor.ts";
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
 *  commit your writes inside `onBatch`, return the cursor you committed. */
export type IndexConsumeOptions<
	TItem extends IndexFeedItem,
	TEnvelope extends IndexFeedEnvelope,
> = {
	/** Resume from a committed checkpoint. Without it (and without
	 *  `fromHeight`) the API serves only the recent default window. */
	fromCursor?: string | null;
	/** Start a fresh sweep at this height (e.g. `0` for genesis backfill).
	 *  Ignored once a cursor exists. */
	fromHeight?: number;
	/** `tail` (default) keeps polling at the tip; `bounded` returns on the
	 *  first empty page. */
	mode?: "tail" | "bounded";
	/** Emit only rows at or below the tip's `finalized_height`; the
	 *  unfinalized tail is re-read each poll until it settles. Finalized data
	 *  never reorgs, so `onReorg` is skipped entirely. */
	finalizedOnly?: boolean;
	batchSize?: number;
	onBatch: (
		items: TItem[],
		envelope: TEnvelope,
		ctx: { cursor: string | null },
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
>(
	opts: IndexConsumeOptions<TItem, TEnvelope> & {
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
	let cursor = opts.fromCursor ?? null;
	// In-memory only: rollback is idempotent, so a crash before the rewind is
	// re-detected and re-applied harmlessly on restart — no need to persist.
	const handledReorgs = new Set<string>();
	let pages = 0;
	let emptyPolls = 0;

	while (
		pages < maxPages &&
		emptyPolls < maxEmptyPolls &&
		!opts.signal?.aborted
	) {
		const envelope = await opts.fetchPage({
			cursor,
			fromHeight: cursor === null ? opts.fromHeight : undefined,
			limit: batchSize,
		});
		pages++;

		// Reorgs: roll back each new fork, then rewind to the lowest fork point
		// and re-read the now-canonical run. Finalized data never reorgs, so
		// `finalizedOnly` skips this entirely.
		if (!finalizedOnly && opts.onReorg) {
			const fresh = envelope.reorgs
				.filter((reorg) => !handledReorgs.has(reorg.id))
				.sort((a, b) => a.fork_point_height - b.fork_point_height);
			if (fresh.length > 0) {
				const forkPoint = Math.min(
					...fresh.map((reorg) => reorg.fork_point_height),
				);
				const rewind = Cursor.atHeight(forkPoint);
				for (const reorg of fresh) {
					await opts.onReorg(reorg, { cursor: rewind });
					handledReorgs.add(reorg.id);
				}
				cursor = rewind;
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

		const returnedCursor = await opts.onBatch(emitted, envelope, {
			cursor: checkpoint,
		});
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
