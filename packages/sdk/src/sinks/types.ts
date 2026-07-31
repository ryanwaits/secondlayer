/**
 * A consumer sink: the destination adapter a consume loop writes through.
 *
 * Without a sink, the user owns the three hard parts of a durable indexer —
 * checkpoint persistence, rows+cursor atomicity, and reorg rollback — and
 * the reasoning that makes them safe lives in doc comments. A sink owns all
 * three: the loop loads its committed cursor, hands the handler a
 * transaction, commits rows AND cursor atomically, and rolls back reorgs
 * without any user code. Crucially, a sink also closes the silent-skip
 * hazard where omitting `onReorg` meant reorgs were ignored forever: with a
 * sink attached, rollback is unconditional.
 *
 * The interface is dependency-free on purpose: implementations with real
 * database drivers live behind subpath exports (`@secondlayer/sdk/sinks/*`)
 * so the root entry ships no DB dependency.
 *
 * ## The contract
 *
 * Binding on every implementation; the conformance kit
 * (`@secondlayer/sdk/sinks/testing`) probes each one. Violations are SILENT
 * in production — they surface as gaps or duplicates weeks later, never as
 * errors at the violation site — which is why they are spelled out here and
 * mechanically tested.
 *
 * What the loop guarantees the sink:
 *
 * 1. **Init-before-first-page.** `loadCursor` is called exactly once, before
 *    the first fetch — even when the caller passed an explicit `fromCursor`.
 *    It is the sink's init hook: create checkpoint storage, validate
 *    rollback preconditions.
 * 2. **Deterministic replay.** Re-reading from the same cursor yields the
 *    same rows in the same order. `cursor` is therefore a valid idempotency
 *    key: an append-only sink can dedup on it with no contract change.
 * 3. **At-least-once delivery.** A batch whose commit outcome was lost (crash
 *    after commit, before the loop observed it) is re-committed on restart
 *    with the SAME cursor and the same rows.
 *
 * What the sink must guarantee — `commitBatch`:
 *
 * 4. **Rows+cursor atomicity.** The handler's writes and `cursor` commit in
 *    ONE transaction. Committing them separately is the classic torn-batch
 *    bug: a crash between the two either re-delivers (duplicates) or skips
 *    (gap) depending on the order.
 * 5. **Abort on throw.** A throw from `write` aborts the WHOLE transaction —
 *    neither rows nor cursor land — so a crashed batch is simply re-read.
 * 6. **The lent transaction is the real one.** `write(tx)` receives the same
 *    live transaction the cursor commits in; every handler write must go
 *    through it. Writes outside `tx` escape atomicity AND rollback.
 * 7. **Replay safety.** Committing the same cursor twice must not corrupt
 *    state (per #3 the rows are identical; upsert/dedup make it exact).
 *
 * What the sink must guarantee — `rollback`:
 *
 * 8. **Delete+rewind atomicity.** Undoing rows at/above the fork and
 *    committing `rewindCursor` happen in ONE transaction. A crash between
 *    them resumes above the fork and the deleted range is never re-read —
 *    the silent-gap bug.
 * 9. **Inclusive fork point.** Undo AT OR ABOVE `forkPointHeight` (`>=`) —
 *    the new canonical chain re-supplies the fork block itself.
 * 10. **Idempotent.** The loop may re-apply the same rollback after a crash
 *     (reorgs are deduped in memory only); a second application must be a
 *     harmless no-op.
 * 11. **Scope by height, not cursor.** On a page reporting several forks the
 *     loop calls `rollback` once per fork: each call carries its own
 *     `forkPointHeight` but ALL carry the same `rewindCursor` (the lowest
 *     fork point). Derive the undo range from `forkPointHeight` only; a
 *     sink that derives it from `rewindCursor` under-deletes silently.
 *
 * Error semantics and concurrency:
 *
 * 12. **Throw, don't swallow; no internal retry.** The loop owns retry
 *     policy. A swallowed commit error advances the loop past unwritten
 *     data; an internal retry can double-apply around a partial failure.
 * 13. **Single writer per checkpoint id.** The loop assumes one live
 *     consumer per checkpoint identity. A sink that can detect a second
 *     writer (e.g. a lock) must fail loudly — never block or interleave.
 */
export interface ConsumerSink<Tx = unknown> {
	/** Phantom marker carrying `Tx` in a directly-inferable position, so the
	 *  consume loops' `TTx` type parameter resolves from the `sink` option
	 *  (never set at runtime). */
	readonly _tx?: Tx;
	/** Static capabilities, read by the loop before the first fetch to fail
	 *  fast on impossible pairings. */
	readonly capabilities?: {
		/** This sink cannot undo committed rows (append-only store, ClickHouse,
		 *  parquet, …), so `rollback` is unimplementable and following the
		 *  unfinalized tip would corrupt it on the first fork. The loop throws
		 *  loudly unless consuming with `finalizedOnly: true` — in that mode
		 *  reorgs never reach the sink and `rollback` may simply throw. */
		finalizedOnly?: boolean;
	};
	/** The committed checkpoint, or `null` on first run. Called once, before
	 *  the first page. Implementations may create their checkpoint storage
	 *  here and SHOULD validate their rollback preconditions (e.g. that every
	 *  declared table carries the height column). */
	loadCursor(): Promise<string | null>;
	/**
	 * Apply one batch atomically: open a transaction, run `write(tx)` (the
	 * user's inserts), and commit the rows AND `cursor` together. A throw
	 * from `write` must abort the whole transaction — leaving neither rows
	 * nor cursor, so a crashed batch is simply re-read on restart.
	 */
	commitBatch(
		cursor: string,
		write: (tx: Tx) => Promise<void> | void,
	): Promise<void>;
	/**
	 * Roll the projection back to the fork: delete everything AT OR ABOVE
	 * `forkPointHeight` (inclusive `>=` — the new chain re-supplies the fork
	 * block) and commit `rewindCursor` in the SAME transaction. Deleting
	 * without the rewound cursor is the classic silent-gap bug: a crash
	 * between the two writes resumes above the fork and the deleted range is
	 * never re-read.
	 *
	 * On a multi-fork page this is called once PER fork, every call with the
	 * same `rewindCursor` (the lowest fork point) but its own
	 * `forkPointHeight` — scope the undo by `forkPointHeight` only (contract
	 * invariant #11), and expect re-application after a crash (#10).
	 */
	rollback(forkPointHeight: number, rewindCursor: string): Promise<void>;
}

/** The transaction type a sink hands to `onBatch` (`ctx.tx`). */
export type SinkTx<S> = S extends ConsumerSink<infer Tx> ? Tx : never;

/** `ctx` gains `tx` exactly when a sink is attached; without one the shape
 *  is unchanged (an intersection with `unknown` is an identity, so
 *  contextual typing of `onBatch` callbacks never degrades to a union). */
export type WithSinkTx<TTx> = [TTx] extends [never] ? unknown : { tx: TTx };
