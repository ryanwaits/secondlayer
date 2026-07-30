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
 */
export interface ConsumerSink<Tx = unknown> {
	/** Phantom marker carrying `Tx` in a directly-inferable position, so the
	 *  consume loops' `TTx` type parameter resolves from the `sink` option
	 *  (never set at runtime). */
	readonly _tx?: Tx;
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
	 */
	rollback(forkPointHeight: number, rewindCursor: string): Promise<void>;
}

/** The transaction type a sink hands to `onBatch` (`ctx.tx`). */
export type SinkTx<S> = S extends ConsumerSink<infer Tx> ? Tx : never;

/** `ctx` gains `tx` exactly when a sink is attached; without one the shape
 *  is unchanged (an intersection with `unknown` is an identity, so
 *  contextual typing of `onBatch` callbacks never degrades to a union). */
export type WithSinkTx<TTx> = [TTx] extends [never] ? unknown : { tx: TTx };
