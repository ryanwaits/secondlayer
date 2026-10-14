// Canonical event primitives (StreamsEvent, payload types, event-type vocab)
// live in @secondlayer/shared/streams-rows; re-exported here so the public
// Streams surface is unchanged.
import type { VmEventType } from "@secondlayer/shared";
import {
	RUNE_EVENT_TYPES,
	type RuneEventType,
	type RuneStreamsEvent,
	STREAMS_EVENT_TYPES,
	type StreamsEvent,
	type StreamsEventType,
	type StreamsWireEvent,
	type VmStreamsEvent,
} from "@secondlayer/shared/streams-rows";
import type { IndexEvent } from "../index-api/client.ts";
import type { ConsumerSink, WithSinkTx } from "../sinks/types.ts";

export {
	RUNE_EVENT_TYPES,
	STREAMS_EVENT_TYPES,
	type RuneEventType,
	type RuneStreamsEvent,
	type StreamsEvent,
	type StreamsEventType,
	type VmStreamsEvent,
};
export type {
	FtBurnPayload,
	FtMintPayload,
	FtTransferPayload,
	MapDeletePayload,
	MapWritePayload,
	NestedContractCallPayload,
	VarSetPayload,
	StreamsWireEvent,
	NftBurnPayload,
	NftMintPayload,
	NftTransferPayload,
	PrintPayload,
	RuneEtchEntry,
	RuneEventPayload,
	StreamsClarityValue,
	StreamsEventBase,
	StreamsEventPayload,
	StxBurnPayload,
	StxLockPayload,
	StxMintPayload,
	StxTransferPayload,
} from "@secondlayer/shared/streams-rows";

/** The chain tip: latest block, Bitcoin anchor, and finality boundary. */
export type StreamsTip = {
	block_height: number;
	block_hash: string;
	burn_block_height: number;
	/**
	 * Highest Stacks block past the burn-confirmation finality boundary.
	 * Optional for back-compat; the API always sets it.
	 */
	finalized_height?: number;
	lag_seconds: number;
	/**
	 * Oldest height still seekable on the live API for the caller's tier
	 * (`tip - retention`). `null` = unlimited retention. Older reads must use the
	 * cold dumps lane. Optional for back-compat.
	 */
	oldest_seekable_height?: number | null;
	/** Oldest seekable cursor (`<oldest_seekable_height>:0`); `null` = unlimited. */
	oldest_cursor?: string | null;
};

/**
 * The Bitcoin tip, without burn-chain or retention fields.
 *
 * Bitcoin has no burn chain of its own, and Runes reads have no retention
 * ladder. Returned by `tip({ chain: "bitcoin" })`.
 */
export type StreamsBitcoinTip = {
	block_height: number;
	block_hash: string;
	finalized_height: number;
	lag_seconds: number;
};

/** A canonical Stacks block with its Bitcoin anchor. */
export type StreamsCanonicalBlock = {
	block_height: number;
	block_hash: string;
	burn_block_height: number;
	burn_block_hash: string | null;
	is_canonical: true;
};

/** A Bitcoin canonical block, without burn-chain fields. */
export type StreamsBitcoinCanonicalBlock = {
	block_height: number;
	block_hash: string;
	is_canonical: true;
};

export type StreamsReorg = {
	detected_at: string;
	fork_point_height: number;
	orphaned_range: { from: string; to: string };
	/**
	 * First position of the new canonical chain at the fork, `fork:0`
	 * (INCLUSIVE). Not an exclusive resume token — resuming directly from it
	 * skips `fork:0`. The consumer rewinds to the foot of `fork_point_height`
	 * (`Cursor.atHeight`) to re-read the new run from `fork:0` inclusive.
	 */
	new_canonical_tip: string;
};

/** One page of events with the next cursor, tip, and reorgs. */
export type StreamsEventsEnvelope<TEvent = StreamsEvent, TTip = StreamsTip> = {
	events: TEvent[];
	next_cursor: string | null;
	tip: TTip;
	reorgs: StreamsReorg[];
};

/** One page of events with the tip and reorgs, no cursor. */
export type StreamsEventsListEnvelope<
	TEvent = StreamsEvent,
	TTip = StreamsTip,
> = Omit<StreamsEventsEnvelope<TEvent, TTip>, "next_cursor">;

/**
 * The event union narrowed to a `types` selection.
 *
 * A const-generic `types: ["ft_transfer"]` narrows the event type.
 */
export type StreamsEventOfTypes<T extends readonly StreamsEventType[]> =
	Extract<StreamsEvent, { event_type: T[number] }>;

/** A starting point and limit for listing reorgs. */
export type StreamsReorgsListParams = {
	since: string;
	limit?: number;
};

/** A list of reorgs and the cursor to resume from. */
export type StreamsReorgsListEnvelope = {
	reorgs: StreamsReorg[];
	next_since: string | null;
};

/** A single value or a list of values to match. */
export type StreamsFilterValue = string | readonly string[];

/**
 * One labelled filter group. Fields inside a group AND together; groups in a
 * map OR together server-side.
 */
export type StreamsLabelledFilter = {
	types?: readonly StreamsEventType[];
	contractId?: StreamsFilterValue;
	sender?: StreamsFilterValue;
	recipient?: StreamsFilterValue;
	assetIdentifier?: string;
};

/** A map of label → filter group. Labels are yours; the server echoes them. */
export type StreamsFilterMap = Record<string, StreamsLabelledFilter>;

/**
 * The events one label can yield. A group that declares `types` narrows to
 * exactly those variants, so a per-label handler needs no `event_type` guard;
 * a group without `types` keeps the full union.
 */
export type StreamsEventForFilter<F, D extends boolean = false> = F extends {
	types: readonly (infer T extends StreamsEventType)[];
}
	? D extends true
		? Extract<IndexEvent, { event_type: T }>
		: Extract<StreamsEvent, { event_type: T }>
	: D extends true
		? IndexEvent
		: StreamsEvent;

/** Cursor, height range, and limit shared by every list call. */
type StreamsEventsListParamsCommon = {
	cursor?: string | null;
	fromHeight?: number;
	toHeight?: number;
	limit?: number;
};

/** `chain: "stacks"` (default, omit `chain` entirely) — unchanged since before Runes events
 *  were added. */
export type StreamsEventsStacksListParams = StreamsEventsListParamsCommon & {
	chain?: "stacks";
	/** `vm` reads ordinal. Omit for Streams 1.0. */
	clock?: "classic" | "vm";
	types?: readonly (StreamsEventType | VmEventType)[];
	/** Event types to exclude (applied after `types`). */
	notTypes?: readonly (StreamsEventType | VmEventType)[];
	contractId?: StreamsFilterValue;
	sender?: StreamsFilterValue;
	recipient?: StreamsFilterValue;
	assetIdentifier?: string;
	/**
	 * Labelled filter groups. The groups OR together in one scan and each
	 * returned event carries the labels it matched (`event.matched`) — two
	 * unrelated concerns share one page, one cursor, one checkpoint.
	 */
	filters?: StreamsFilterMap;
};

/**
 * List options for Runes events, with their own cursor space.
 *
 * `types` is restricted to `RuneEventType` at the type level, so e.g. `{ chain:
 * "bitcoin", types: ["ft_transfer"] }` is a compile error rather than a silent
 * 400 at request time. `contractId`, `sender`, `recipient`, `assetIdentifier`,
 * `filters`, and `clock` don't exist on this branch; they're Stacks-only (the
 * server 400s on them too).
 */
export type StreamsEventsBitcoinListParams = StreamsEventsListParamsCommon & {
	chain: "bitcoin";
	types?: readonly RuneEventType[];
	notTypes?: readonly RuneEventType[];
	/** A RuneRef: an id (`840000:3`) or a name (`DOG•GO•TO•THE•MOON`). */
	rune?: string;
	/** A mainnet address. */
	address?: string;
};

/** Chain, cursor, height range, and filters for listing Streams events. */
export type StreamsEventsListParams =
	| StreamsEventsStacksListParams
	| StreamsEventsBitcoinListParams;

/** Cursor, batching, and stop options shared by every event stream. */
type StreamsEventsStreamCommon = {
	fromCursor?: string | null;
	batchSize?: number;
	emptyBackoffMs?: number;
	maxPages?: number;
	maxEmptyPolls?: number;
	signal?: AbortSignal;
};

/**
 * Stream options for Stacks events, the default chain.
 *
 * `chain: "stacks"` is the default, so omit `chain` entirely. Matches
 * `StreamsEventsStacksListParams`.
 */
export type StreamsEventsStreamStacksParams = StreamsEventsStreamCommon & {
	chain?: "stacks";
	types?: readonly StreamsEventType[];
	notTypes?: readonly StreamsEventType[];
	contractId?: StreamsFilterValue;
	sender?: StreamsFilterValue;
	recipient?: StreamsFilterValue;
	assetIdentifier?: string;
	/** Labelled filter groups; see {@link StreamsEventsListParams.filters}. */
	filters?: StreamsFilterMap;
};

/**
 * Stream options for Runes events, tailed like the Stacks default.
 *
 * `types` is restricted to `RuneEventType` at the type level, matching
 * `StreamsEventsBitcoinListParams`. `contractId`, `sender`, `recipient`,
 * `assetIdentifier`, and `filters` don't exist on this branch; they're
 * Stacks-only.
 */
export type StreamsEventsStreamBitcoinParams = StreamsEventsStreamCommon & {
	chain: "bitcoin";
	types?: readonly RuneEventType[];
	notTypes?: readonly RuneEventType[];
	/** A RuneRef: an id (`840000:3`) or a name (`DOG•GO•TO•THE•MOON`). */
	rune?: string;
	/** A mainnet address. */
	address?: string;
};

export type StreamsEventsStreamParams =
	| StreamsEventsStreamStacksParams
	| StreamsEventsStreamBitcoinParams;

type StreamsEventsSubscribeCommon = {
	/** Resume strictly after this cursor; omit to live-tail from the tip. */
	fromCursor?: string | null;
	/** Abort to unsubscribe (the returned function does the same). */
	signal?: AbortSignal;
	/**
	 * Called on every failure. Transport errors (dropped socket, 5xx, 429, a
	 * stale connection, a throwing handler) reconnect from the last handled
	 * cursor with exponential backoff. Errors that a retry cannot fix (401,
	 * 4xx, a bad signature) end the subscription and reject its `done`.
	 */
	onError?: (err: unknown) => void;
	/**
	 * First reconnect pause in ms (default 1000). Doubles per consecutive
	 * failure up to 30 s with jitter, resets once a frame arrives, and never
	 * undercuts a `Retry-After`.
	 */
	reconnectDelayMs?: number;
	/**
	 * Reconnect when no frame (pings included) arrives for this long (default
	 * 60000, three server heartbeats). Catches a half-open socket that never
	 * errors; set it above your instance's heartbeat interval.
	 */
	staleAfterMs?: number;
};

/** `chain: "stacks"` (default, omit `chain` entirely). */
export type StreamsEventsSubscribeStacksParams =
	StreamsEventsSubscribeCommon & {
		chain?: "stacks";
		types?: readonly StreamsEventType[];
		notTypes?: readonly StreamsEventType[];
		contractId?: StreamsFilterValue;
		sender?: StreamsFilterValue;
		recipient?: StreamsFilterValue;
		assetIdentifier?: string;
		/** Labelled filter groups; see {@link StreamsEventsListParams.filters}. */
		filters?: StreamsFilterMap;
		/**
		 * Called for each pushed event, in order. The resume cursor advances only
		 * after this resolves, so a handler that throws sees the same event again
		 * on reconnect (at-least-once). Key durable writes by `cursor`.
		 */
		onEvent: (event: StreamsEvent) => void | Promise<void>;
	};

/**
 * Options for pushing Runes events live, on their own cursor space.
 *
 * `contractId`, `sender`, `recipient`, `assetIdentifier`, and `filters` don't
 * exist on this branch; they're Stacks-only.
 */
export type StreamsEventsSubscribeBitcoinParams =
	StreamsEventsSubscribeCommon & {
		chain: "bitcoin";
		types?: readonly RuneEventType[];
		notTypes?: readonly RuneEventType[];
		/** A RuneRef: an id (`840000:3`) or a name (`DOG•GO•TO•THE•MOON`). */
		rune?: string;
		/** A mainnet address. */
		address?: string;
		onEvent: (event: RuneStreamsEvent) => void | Promise<void>;
	};

export type StreamsEventsSubscribeParams =
	| StreamsEventsSubscribeStacksParams
	| StreamsEventsSubscribeBitcoinParams;

/**
 * Handle for a live subscription: call it to unsubscribe. `done` resolves
 * after unsubscribe (or the signal aborting) and rejects with the error that
 * ended the loop when a retry could not fix it, so a worker can `await`
 * it instead of polling for silence.
 */
export type StreamsSubscription = {
	(): void;
	done: Promise<void>;
};

/**
 * The checkpoint the SDK computes for a batch. Persist `cursor` inside the same
 * transaction as your projection writes, then resume from it via `fromCursor`.
 * It is the position to advance to: `next_cursor` normally, or the last
 * finalized event when `finalizedOnly` is set.
 */
/**
 * What the loop knows at the end of a page, handed to `onBatch`.
 *
 * `cursor` is the position to commit. The rest answers "how far along am I,
 * and am I still moving" — the question every deployed consumer has to expose
 * for a health check.
 *
 * Progress is reported here rather than left to callers because only the loop
 * can get it right: `height` has to survive empty pages (normal at the tip)
 * and has to roll back to `fork_point_height - 1` after a reorg rewind.
 * Deriving it from `cursor` is wrong — `Cursor.atHeight` encodes the foot of a
 * block as `${height - 1}:<sentinel>`, so a rewound cursor parses to a
 * position that was never reached.
 */
export type ConsumerBatchContext<TTip = unknown, TReorg = unknown> = {
	/** Checkpoint to commit alongside your rows. */
	cursor: string | null;
	/** Highest canonical block a row was DELIVERED from. `null` before the
	 *  first row of a fresh consume. With a sparse filter this parks at the
	 *  last matching event — it measures event recency, not progress. */
	height: number | null;
	/** Highest canonical block the sweep has VERIFIED through: an empty page
	 *  is the server confirming nothing matches between the cursor and the
	 *  tip, so a caught-up tail scans to the tip even when `height` is far
	 *  below it. Rolls back with reorg rewinds. */
	scannedHeight: number | null;
	/** Chain tip as of this page's read. */
	tipHeight: number;
	/** `tipHeight - scannedHeight`, floored at 0 — the consumer's actual
	 *  backlog. `null` until a position is known. A caught-up consumer on a
	 *  quiet contract reads ~0 here while `tipHeight - height` grows — that
	 *  difference is event age, not lag. */
	blocksBehind: number | null;
	/**
	 * The full tip for this page — `StreamsTip` or `IndexTip` depending on the
	 * surface. Exposed here so a handler never needs the `envelope` parameter,
	 * which is the only way to reach it today and is also how the worst
	 * `finalizedOnly` mistake becomes reachable (`return envelope.next_cursor`
	 * jumps the cursor past events that were filtered out and never delivered).
	 */
	tip: TTip;
	/**
	 * Reorgs reported alongside this page; empty when none. Rollback still
	 * belongs in `onReorg` — this is for observability inside a batch.
	 */
	reorgs: readonly TReorg[];
};

/** @deprecated Use {@link ConsumerBatchContext} — the Index and Streams loops
 *  share one shape now. Kept as an alias so existing annotations compile. */
export type StreamsBatchContext = ConsumerBatchContext;

/**
 * The checkpoint for a reorg rollback. Persist `cursor` (the rewind position)
 * inside the same transaction as your rollback so the two commit atomically.
 */
/** `cursor` is the rewind position the loop resumes from after `onReorg`:
 *  the foot of the fork point, or `null` for a fork at genesis. Persist it
 *  in the same transaction as the rollback. */
export type StreamsReorgContext = { cursor: string | null };

/** Options for consuming Streams events: cursor, batching, filters, handler. */
export type StreamsEventsConsumeParams<
	TTx = never,
	D extends boolean = false,
	F extends StreamsFilterMap = Record<never, never>,
> = {
	/** `chain: "stacks"` (default, omit `chain` entirely) — the bitcoin branch
	 *  is {@link StreamsEventsConsumeBitcoinParams}, a separate overload with
	 *  no `filters`/`on`/`decoded` (Stacks-only concepts). */
	chain?: "stacks";
	fromCursor?: string | null;
	/**
	 * Deliver events pre-decoded as the flat, `event_type`-discriminated rows
	 * Index serves (`IndexEvent`), so Streams consumption reads identically
	 * to Index consumption — no guard+decode pairs in your handler.
	 */
	decoded?: D;
	/**
	 * Destination adapter that owns the checkpoint + rollback transaction
	 * (e.g. `kyselySink` from `@secondlayer/sdk/sinks/kysely`). With a sink:
	 * the loop resumes from the sink's committed cursor, `onBatch` receives
	 * `ctx.tx` and must write ONLY through it (rows and cursor commit in one
	 * transaction), reorg rollback is automatic, and `onBatch`'s return value
	 * is ignored. Folds (balances) invert in the sink's `onRollback`, not in
	 * `onReorg`.
	 */
	sink?: ConsumerSink<TTx>;
	/** Fires once per page, before `onBatch` and before any early return. */
	onProgress?: (ctx: ConsumerBatchContext) => void;
	mode?: "tail" | "bounded";
	/**
	 * Emit only finalized (immutable) events and never surface reorgs. The SDK
	 * checkpoints at the last finalized event and re-reads the unfinalized tail
	 * until it settles. Trades finality lag for zero reorg handling; `onReorg` is
	 * ignored.
	 */
	finalizedOnly?: boolean;
	types?: readonly StreamsEventType[];
	notTypes?: readonly StreamsEventType[];
	contractId?: StreamsFilterValue;
	sender?: StreamsFilterValue;
	recipient?: StreamsFilterValue;
	assetIdentifier?: string;
	/**
	 * Labelled filter groups. The groups OR together in ONE server-side scan,
	 * so two unrelated concerns share one page, one cursor, and one checkpoint
	 * instead of two consume loops. Pair with `on` to handle each label.
	 */
	filters?: F;
	/**
	 * One handler per label in `filters`. Every label must be handled, so
	 * adding a label is a compile error until its handler exists.
	 *
	 * A label's declared `types` narrows its handler's events, so `payload` is
	 * typed without an `event_type` guard. Labels are dispatched in declaration
	 * order: a label's own events stay in cursor order, but events of different
	 * labels do not interleave within a page — add `onBatch` when you need
	 * strict global order across labels.
	 */
	on?: {
		[K in keyof F]: (
			events: StreamsEventForFilter<F[K], D>[],
			ctx: StreamsBatchContext & WithSinkTx<TTx>,
		) => void | Promise<void>;
	};
	batchSize?: number;
	/**
	 * Apply a page of canonical events. Persist `ctx.cursor` in the same
	 * transaction as your writes. Returning a cursor overrides `ctx.cursor` as
	 * the resume point (advanced manual control); returning nothing uses it.
	 *
	 * Optional only when `on` handles the page instead; a consume call with
	 * neither throws.
	 */
	onBatch?: (
		events: D extends true ? IndexEvent[] : StreamsEvent[],
		/**
		 * @deprecated Read `ctx.tip` / `ctx.reorgs` instead. The envelope is
		 * also how the worst `finalizedOnly` mistake stays reachable —
		 * returning `envelope.next_cursor` jumps the cursor past unfinalized
		 * events that were filtered out and never delivered. Removed in the
		 * next major.
		 */
		envelope: StreamsEventsEnvelope,
		ctx: StreamsBatchContext & WithSinkTx<TTx>,
	) =>
		| void
		| string
		| null
		| undefined
		| Promise<void>
		| Promise<string | null | undefined>;
	/**
	 * Roll your projection back to `reorg.fork_point_height`, persisting
	 * `ctx.cursor` in the same transaction. Called once per *new* reorg at or
	 * below the checkpoint (deduped in-memory, fork-ascending) before the SDK
	 * rewinds and re-reads the now-canonical events. A reorg whose fork sits
	 * above the checkpoint is not a rollback (nothing past it was written) and
	 * is skipped. Omit it to ignore reorgs (events stay canonical, but stale
	 * rows from an orphaned fork are left in place).
	 *
	 * With `onReorg` or a `sink` attached, every empty page also polls
	 * `reorgs.list` (one extra request per idle poll) so a fork that lands
	 * while the consumer idles at the tip is rolled back too.
	 */
	onReorg?: (
		reorg: StreamsReorg,
		ctx: StreamsReorgContext,
	) => Promise<void> | void;
	/** Deepest rewind one reorg may make below the checkpoint before the loop
	 *  refuses with `ValidationError`. Default 1000 blocks. The fork point is
	 *  server supplied and drives a delete on every declared table, so raise
	 *  this only for a source you trust. */
	maxRollbackDepth?: number;
	/** Page-fetch retries after the first failure (429/5xx/network only —
	 *  4xx and handler throws always propagate). Default 3; `0` disables. */
	retryCount?: number;
	/** Base retry delay in ms; the n-th retry waits `retryDelay * n`. A server
	 *  `Retry-After` overrides it. Default 1000. */
	retryDelay?: number;
	/** Void observer, called before each retry sleep (metrics/logging). */
	onError?: (
		err: unknown,
		ctx: { attempt: number; retriesLeft: number; delayMs: number },
	) => void;
	emptyBackoffMs?: number;
	maxPages?: number;
	maxEmptyPolls?: number;
	signal?: AbortSignal;
	/**
	 * Cuts the empty-poll backoff short: on an empty page, the loop races
	 * `emptyBackoffMs` against this promise instead of sleeping the full
	 * amount. Pass a function that resolves once when new data MIGHT be
	 * available (e.g. a Postgres NOTIFY listener) — it is called fresh on
	 * every empty page, never awaited more than once concurrently per page.
	 * The backoff timer still runs underneath, so a wake source that never
	 * resolves (or a `wake` this call omits) degrades to the same polling
	 * behavior as before.
	 */
	wake?: () => Promise<void>;
};

/**
 * Options for the checkpointed sweep over Runes events.
 *
 * A separate, simpler type from `StreamsEventsConsumeParams` rather than a
 * widened union member: `filters`, `on`, and `decoded` are Stacks-only concepts
 * (labelled OR-groups and Index-shaped projection have no Runes equivalent
 * yet), so `onBatch` is the only way in and is required. Reorg rewind still
 * works the same way (bitcoin reorgs carry the same `fork_point_height` and
 * `new_canonical_tip` shape as Stacks ones).
 */
export type StreamsEventsConsumeBitcoinParams<TTx = never> = {
	chain: "bitcoin";
	fromCursor?: string | null;
	sink?: ConsumerSink<TTx>;
	onProgress?: (ctx: ConsumerBatchContext) => void;
	mode?: "tail" | "bounded";
	finalizedOnly?: boolean;
	types?: readonly RuneEventType[];
	notTypes?: readonly RuneEventType[];
	/** A RuneRef: an id (`840000:3`) or a name (`DOG•GO•TO•THE•MOON`). */
	rune?: string;
	/** A mainnet address. */
	address?: string;
	batchSize?: number;
	onBatch: (
		events: RuneStreamsEvent[],
		envelope: StreamsEventsEnvelope<RuneStreamsEvent, StreamsBitcoinTip>,
		ctx: StreamsBatchContext & WithSinkTx<TTx>,
	) =>
		| void
		| string
		| null
		| undefined
		| Promise<void>
		| Promise<string | null | undefined>;
	onReorg?: (
		reorg: StreamsReorg,
		ctx: StreamsReorgContext,
	) => Promise<void> | void;
	maxRollbackDepth?: number;
	retryCount?: number;
	retryDelay?: number;
	onError?: (
		err: unknown,
		ctx: { attempt: number; retriesLeft: number; delayMs: number },
	) => void;
	emptyBackoffMs?: number;
	maxPages?: number;
	maxEmptyPolls?: number;
	signal?: AbortSignal;
	wake?: () => Promise<void>;
};

/**
 * One page yielded by `consume`, with `cursor` to persist and resume.
 *
 * It is the `GET /v1/streams/events` envelope verbatim, with `next_cursor`
 * renamed to `cursor`.
 */
export type StreamsBatch<TEvent = StreamsEvent, TTip = StreamsTip> = {
	/** Canonical events of this page, in cursor order. */
	events: TEvent[];
	/** Checkpoint after this page — pass back as `consume({ cursor })` to resume. */
	cursor: string | null;
	tip: TTip;
	/** Chain reorgs reported alongside this page; empty when none. */
	reorgs: StreamsReorg[];
};

/** Cursor, batch size, and polling options shared by every consume loop. */
type StreamsConsumeCommon = {
	/** Resume strictly after this cursor; omit to start from the oldest seekable page. */
	cursor?: string | null;
	/** Events per page (the `limit` query param). Default 100. */
	batchSize?: number;
	/** Poll interval while caught up at the tip, in ms. Default 2000. */
	intervalMs?: number;
	/** Abort to end the iteration. */
	signal?: AbortSignal;
};

/** `chain: "stacks"` (default, omit `chain` entirely). */
export type StreamsConsumeStacksParams = StreamsConsumeCommon & {
	chain?: "stacks";
	types?: readonly StreamsEventType[];
	notTypes?: readonly StreamsEventType[];
	contractId?: StreamsFilterValue;
	sender?: StreamsFilterValue;
	recipient?: StreamsFilterValue;
	assetIdentifier?: string;
	/** Labelled OR-groups — same semantics as `events.consume`; each returned
	 *  event echoes the labels it matched. */
	filters?: StreamsFilterMap;
};

/**
 * Consume options for Runes batches, with their own cursor space.
 *
 * `contractId`, `sender`, `recipient`, `assetIdentifier`, and `filters` don't
 * exist on this branch; they're Stacks-only.
 */
export type StreamsConsumeBitcoinParams = StreamsConsumeCommon & {
	chain: "bitcoin";
	types?: readonly RuneEventType[];
	notTypes?: readonly RuneEventType[];
	/** A RuneRef: an id (`840000:3`) or a name (`DOG•GO•TO•THE•MOON`). */
	rune?: string;
	/** A mainnet address. */
	address?: string;
};

export type StreamsConsumeParams =
	| StreamsConsumeStacksParams
	| StreamsConsumeBitcoinParams;

/** Where a consume loop stopped: cursor, pages read, empty polls. */
export type StreamsEventsConsumeResult = {
	cursor: string | null;
	pages: number;
	emptyPolls: number;
};

/** Options for replaying history from dump files, then tailing live. */
export type StreamsEventsReplayParams = {
	/** Start point: `"genesis"` (default) or a `<block>:<index>` cursor. */
	from?: "genesis" | string;
	/**
	 * Called once per finalized dump file, in block order, before live tailing.
	 * Process the parquet with your own tooling (e.g. DuckDB) — the SDK does not
	 * decode parquet. Use `client.dumps.download(file)` to fetch + verify bytes.
	 *
	 * Delivery is file-granular and at-least-once: a file whose range straddles
	 * `from` is handed over whole. `ctx.from` is that cursor (`null` from
	 * genesis); skip rows at or below it, or key rows by `cursor` so a re-run
	 * is an idempotent no-op. Files ending at or below `from` are not handed
	 * over at all.
	 */
	onDumpFile: (
		file: StreamsDumpFile,
		ctx: { from: string | null },
	) => Promise<void> | void;
	/** Called per live page after the dump phase, like `consume`. */
	onBatch: (
		events: StreamsEvent[],
		envelope: StreamsEventsEnvelope,
	) => Promise<string | null | undefined> | string | null | undefined;
	/**
	 * Called when the live-tail phase (after the dump backfill) crosses a reorg,
	 * before the cursor rewinds and re-reads the now-canonical events — same
	 * contract as `consume`. The dump-backfill phase is finalized and never
	 * reorgs; omit this to leave stale rows from an orphaned fork in place.
	 */
	onReorg?: (
		reorg: StreamsReorg,
		ctx: StreamsReorgContext,
	) => Promise<void> | void;
	mode?: "tail" | "bounded";
	batchSize?: number;
	emptyBackoffMs?: number;
	maxPages?: number;
	maxEmptyPolls?: number;
	signal?: AbortSignal;
	/** Narrow the LIVE TAIL after the dump phase. The dump files themselves are
	 *  always all-type (block-partitioned parquet) — filter those in your own
	 *  tooling while processing each file. */
	types?: readonly StreamsEventType[];
	notTypes?: readonly StreamsEventType[];
	/** Labelled OR-groups for the live tail, like `consume`. */
	filters?: StreamsFilterMap;
};

export type FetchLike = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

/** One bulk parquet file in the dumps manifest. `path` is the object key under
 *  the dumps base URL. */
export type StreamsDumpFile = {
	path: string;
	from_block: number;
	to_block: number;
	min_cursor: string | null;
	max_cursor: string | null;
	row_count: number;
	byte_size: number;
	sha256: string;
	schema_version: number;
	created_at: string;
};

/** The index of finalized Parquet dump files for one dataset. */
export type StreamsDumpsManifest = {
	dataset: string;
	network: string;
	version: string;
	schema_version: number;
	generated_at: string;
	producer_version: string;
	finality_lag_blocks: number;
	/** Cursor at the end of the finalized bulk coverage — hand to live tailing. */
	latest_finalized_cursor: string | null;
	coverage: { from_block: number; to_block: number };
	files: StreamsDumpFile[];
	/** ed25519 signature over the manifest's canonical bytes. Absent on legacy
	 *  unsigned manifests. Verified by `list()` when `verifyDumpsManifest` is on. */
	signature?: string;
	/** Short id of the signing public key. */
	key_id?: string;
};

export type StreamsDumps = {
	/** Fetch and parse the latest dumps manifest. */
	list(): Promise<StreamsDumpsManifest>;
	/** Absolute URL for a manifest file. */
	fileUrl(file: StreamsDumpFile): string;
	/** Download a parquet file and verify its sha256 against the manifest. */
	download(file: StreamsDumpFile): Promise<Uint8Array>;
};

export type StreamsClient = {
	/**
	 * Read Streams page by page as an async iterator.
	 *
	 * Yields one {@link StreamsBatch} per events page, so each yield is exactly
	 * one API call. Empty pages are skipped; at the tip the iterator polls again
	 * every `intervalMs` (default 2000) until `signal` aborts.
	 *
	 * Reorgs appear on `batch.reorgs`, but the cursor is not rewound for you.
	 * Use `events.consume` with `onReorg` when you need rollback.
	 *
	 * A literal `types` array narrows every batch's event union to those types.
	 * `chain: "bitcoin"` batches carry Runes rows only, on the bitcoin tip shape.
	 */
	consume(
		params: StreamsConsumeBitcoinParams,
	): AsyncIterableIterator<StreamsBatch<RuneStreamsEvent, StreamsBitcoinTip>>;
	consume<const T extends readonly StreamsEventType[]>(
		params: StreamsConsumeStacksParams & { types: T },
	): AsyncIterableIterator<StreamsBatch<StreamsEventOfTypes<T>>>;
	consume(params?: StreamsConsumeParams): AsyncIterableIterator<StreamsBatch>;
	events: {
		/**
		 * Read one page of chain events and the next cursor.
		 *
		 * Narrow with `types`, `notTypes`, `contractId`, `sender`, `recipient`,
		 * `assetIdentifier`, `fromHeight`/`toHeight`, or labelled `filters`.
		 * Filters match exactly, and an event type without a given field never
		 * matches it. Pass `next_cursor` back as `cursor` to continue. The
		 * envelope also carries the `tip` and any `reorgs`. To write the events
		 * somewhere with a checkpoint, use `events.consume` instead.
		 *
		 * A literal `types` array narrows every row to those event types.
		 * `clock: "vm"` pages carry vm rows only (a parallel vocabulary,
		 * `event_index` = `ordinal`), never `StreamsEvent`; it is Stacks only.
		 * `chain: "bitcoin"` pages carry Runes rows only, on the bitcoin tip shape,
		 * and filter by `rune` or `address`.
		 */
		list(
			params: StreamsEventsStacksListParams & { clock: "vm" },
		): Promise<StreamsEventsEnvelope<VmStreamsEvent>>;
		list<const T extends readonly StreamsEventType[]>(
			params: Omit<
				StreamsEventsStacksListParams,
				"clock" | "types" | "notTypes"
			> & {
				types: T;
				notTypes?: readonly StreamsEventType[];
				clock?: "classic";
			},
		): Promise<StreamsEventsEnvelope<StreamsEventOfTypes<T>>>;
		list(
			params?: Omit<
				StreamsEventsStacksListParams,
				"clock" | "types" | "notTypes"
			> & {
				types?: readonly StreamsEventType[];
				notTypes?: readonly StreamsEventType[];
				clock?: "classic";
			},
		): Promise<StreamsEventsEnvelope>;
		list(
			params: StreamsEventsBitcoinListParams,
		): Promise<StreamsEventsEnvelope<RuneStreamsEvent, StreamsBitcoinTip>>;
		list(
			params: StreamsEventsListParams,
		): Promise<StreamsEventsEnvelope<StreamsWireEvent>>;
		/**
		 * Read every event a transaction emitted.
		 *
		 * Returns the events and the `tip`, with no `next_cursor`: one transaction
		 * is one response.
		 *
		 * `chain: "bitcoin"` returns the Runes events for one Bitcoin transaction.
		 */
		byTxId(
			txId: string,
			opts: { chain: "bitcoin" },
		): Promise<StreamsEventsListEnvelope<RuneStreamsEvent, StreamsBitcoinTip>>;
		byTxId(txId: string): Promise<StreamsEventsListEnvelope>;
		/**
		 * Run a checkpointed indexer that rewinds on reorgs.
		 *
		 * Write your rows in `onBatch` and commit `ctx.cursor` in the same
		 * transaction; resume with `fromCursor`. Reorgs at or below your checkpoint
		 * call `onReorg`, then the loop re-reads from the fork point. Delivery is
		 * at-least-once, so keep writes idempotent. With a `sink`, the checkpoint
		 * and rollback are handled for you. `mode: "tail"` (default) keeps polling
		 * at the tip; `mode: "bounded"` returns on the first empty page. It also
		 * stops on `maxPages`, `maxEmptyPolls`, or `signal`. Pass `finalizedOnly`
		 * to skip reorg handling entirely.
		 *
		 * `chain: "bitcoin"` sweeps Runes events; see
		 * {@link StreamsEventsConsumeBitcoinParams}.
		 */
		consume<TTx = never>(
			params: StreamsEventsConsumeBitcoinParams<TTx> & {
				sink?: ConsumerSink<TTx>;
			},
		): Promise<StreamsEventsConsumeResult>;
		consume<
			const F extends StreamsFilterMap = Record<never, never>,
			TTx = never,
			D extends boolean = false,
		>(
			// The redundant `sink` member gives TS a DIRECT inference site for
			// TTx — inference does not reliably traverse the params alias.
			params: StreamsEventsConsumeParams<TTx, D, F> & {
				sink?: ConsumerSink<TTx>;
			},
		): Promise<StreamsEventsConsumeResult>;
		/**
		 * Backfill from bulk dumps, then continue live in one call.
		 *
		 * Hands each finalized dump file to `onDumpFile` in block order, then tails
		 * live from the manifest's `latest_finalized_cursor`, with no gap or
		 * duplicate at the seam. A file that straddles `from` is delivered whole,
		 * so skip the rows at or below it. Requires `dumpsBaseUrl`.
		 */
		replay(
			params: StreamsEventsReplayParams,
		): Promise<StreamsEventsConsumeResult>;
		/**
		 * Read events one at a time as an async iterator.
		 *
		 * For live processors and watch-style apps that keep their own state. It
		 * tails indefinitely and stops when `signal`, `maxPages`, or
		 * `maxEmptyPolls` ends it. There is no checkpoint or reorg handling; use
		 * `events.consume` for that.
		 *
		 * A literal `types` array narrows every event to those types.
		 * `chain: "bitcoin"` yields Runes events only.
		 */
		stream(
			params: StreamsEventsStreamBitcoinParams,
		): AsyncIterable<RuneStreamsEvent>;
		stream<const T extends readonly StreamsEventType[]>(
			params: StreamsEventsStreamStacksParams & { types: T },
		): AsyncIterable<StreamsEventOfTypes<T>>;
		stream(params?: StreamsEventsStreamParams): AsyncIterable<StreamsEvent>;
		/**
		 * Get each new event pushed to `onEvent` as it lands.
		 *
		 * Reconnects from the last handled cursor after a transport error, and
		 * verifies each frame's ed25519 signature when the client has `verify` on.
		 * Returns an unsubscribe function whose `done` promise settles when the
		 * loop ends. Not reorg-aware: an event delivered and then orphaned is never
		 * retracted. Durable writers use `events.consume`.
		 *
		 * `chain: "bitcoin"` delivers Runes rows to `onEvent`.
		 */
		subscribe(params: StreamsEventsSubscribeBitcoinParams): StreamsSubscription;
		subscribe(params: StreamsEventsSubscribeStacksParams): StreamsSubscription;
	};
	blocks: {
		/**
		 * Read every event in one block, by height or hash.
		 *
		 * Returns the events and the `tip`, with no `next_cursor`.
		 *
		 * `chain: "bitcoin"` returns the Runes events in one Bitcoin block.
		 */
		events(
			heightOrHash: number | string,
			opts: { chain: "bitcoin" },
		): Promise<StreamsEventsListEnvelope<RuneStreamsEvent, StreamsBitcoinTip>>;
		events(heightOrHash: number | string): Promise<StreamsEventsListEnvelope>;
	};
	reorgs: {
		/**
		 * List chain reorgs since a cursor.
		 *
		 * `since` is required. Each reorg gives its `fork_point_height` and the
		 * orphaned range. Page with `next_since`.
		 *
		 * `chain: "bitcoin"` lists Bitcoin reorgs, on their own cursor space.
		 */
		list(
			params: StreamsReorgsListParams & { chain: "bitcoin" },
		): Promise<StreamsReorgsListEnvelope>;
		list(params: StreamsReorgsListParams): Promise<StreamsReorgsListEnvelope>;
	};
	/** Bulk parquet dumps. Requires `dumpsBaseUrl` on the client. */
	dumps: StreamsDumps;
	/**
	 * Get the canonical block at a height.
	 *
	 * Returns the block hash and, on Stacks, the burn block it anchors to.
	 *
	 * `chain: "bitcoin"` returns the Bitcoin block, without burn-chain fields.
	 */
	canonical(
		height: number,
		opts: { chain: "bitcoin" },
	): Promise<StreamsBitcoinCanonicalBlock>;
	canonical(height: number): Promise<StreamsCanonicalBlock>;
	/**
	 * Get the current chain tip.
	 *
	 * Returns the tip height and hash, `finalized_height`, and `lag_seconds`. On
	 * Stacks it also reports the oldest height your tier can seek; older reads
	 * come from the bulk dumps.
	 *
	 * `chain: "bitcoin"` returns the Bitcoin tip, without burn-chain or retention
	 * fields.
	 */
	tip(opts: { chain: "bitcoin" }): Promise<StreamsBitcoinTip>;
	tip(): Promise<StreamsTip>;
};
