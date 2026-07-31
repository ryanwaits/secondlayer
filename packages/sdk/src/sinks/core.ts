import { ValidationError } from "../errors.ts";
import type { ConsumerSink } from "./types.ts";

/** Default checkpoint table name, shared by every SQL-backed sink so two
 *  sinks on the same database land in one table keyed by `id`. */
export const DEFAULT_CHECKPOINT_TABLE = "sl_consumer_checkpoints";

/**
 * The driver surface a database adapter implements — the ~7 methods that
 * actually differ between SQL stores. Everything above them (the
 * commit/rollback call sequences, the guards, identifier validation, the
 * checkpoint schema) is policy owned by {@link createSink}, so a driver
 * cannot get the ordering wrong: it never sees a cursor write outside the
 * transaction that carries the rows, and never sees a delete without the
 * rewound cursor riding along.
 *
 * Identifier args (`table`, `column`) arrive pre-validated against
 * `[A-Za-z_][A-Za-z0-9_]*` — safe to interpolate after quoting (see
 * {@link quoteIdent}). Values (cursor, height, id) must still be bound as
 * parameters.
 */
export interface SinkDriver<Tx> {
	/** Run `fn` inside ONE transaction: begin, run, commit — a throw from
	 *  `fn` must roll the whole transaction back and re-throw. */
	transact<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
	/** Create the checkpoint store if missing: `(id primary key, cursor)`.
	 *  Must be safe under concurrent first start (two consumers racing the
	 *  same CREATE). */
	ensureCheckpointStore(): Promise<void>;
	/** The committed cursor for this sink's `id`, or `null` if none. */
	readCursor(): Promise<string | null>;
	/** Upsert this sink's cursor row inside `tx`. */
	writeCursor(tx: Tx, cursor: string): Promise<void>;
	/** Delete rows with `height column >= height` from `table`, inside `tx`. */
	deleteAtOrAbove(tx: Tx, table: string, height: number): Promise<void>;
	/** Whether `table` exists AND carries `column` — the first-use check that
	 *  keeps reorg rollback from being a silent no-op. */
	hasColumn(table: string, column: string): Promise<boolean>;
	/** Optional: assert this consumer is the only live writer for its `id`,
	 *  inside `tx`. Must FAIL LOUDLY (throw) when another writer holds it —
	 *  never block or interleave (contract invariant #13). */
	acquireLock?(tx: Tx): Promise<void>;
}

/** Options for {@link createSink} — the policy inputs, driver-agnostic.
 *  Concrete sinks re-expose these with schema-typed `tables`/`height`. */
export interface CreateSinkOptions {
	/** Error-message prefix naming the concrete sink (e.g. `"kyselySink"`),
	 *  so a thrown guard points at the thing the user actually constructed. */
	label: string;
	/** Checkpoint identity AND concurrency key. */
	id: string;
	/** Rollback scope: on a reorg, rows at/above the fork point are deleted
	 *  from exactly these tables. */
	tables: readonly string[];
	/** The block-height stamp column, present on every declared table. */
	height: string;
	/** Checkpoint table name. Default {@link DEFAULT_CHECKPOINT_TABLE}. */
	checkpointTable?: string;
	/** Forwarded to {@link ConsumerSink.capabilities}. */
	capabilities?: ConsumerSink["capabilities"];
}

/** Throw unless `name` is a bare SQL identifier (letters, digits,
 *  underscores; no leading digit) — the guard that makes interpolating
 *  table/column names into DDL and DELETE statements safe. */
export function assertSqlIdentifier(name: string, label: string): void {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
		throw new ValidationError(
			`${label}: invalid identifier "${name}" (letters, digits, underscores only).`,
			400,
		);
	}
}

/** Double-quote a (pre-validated) identifier for interpolation. */
export function quoteIdent(name: string): string {
	return `"${name}"`;
}

/**
 * Build a {@link ConsumerSink} from a {@link SinkDriver}: the portable ~90
 * lines every SQL sink otherwise re-implements — and re-risks. Owns the two
 * transaction sequences (begin → lock → write rows → write cursor;
 * begin → lock → delete `>=` fork → write rewound cursor), the empty-`tables`
 * guard, identifier validation, and the first-use height-column check.
 *
 * A driver implemented against this base cannot violate contract invariants
 * #4, #5, #8, #9, or #11 (see {@link ConsumerSink}) without breaking
 * `transact` itself — which is exactly what the conformance kit probes.
 */
export function createSink<Tx>(
	driver: SinkDriver<Tx>,
	options: CreateSinkOptions,
): ConsumerSink<Tx> {
	const { label } = options;
	const checkpointTable = options.checkpointTable ?? DEFAULT_CHECKPOINT_TABLE;
	if (options.tables.length === 0) {
		throw new ValidationError(
			`${label}: \`tables\` is empty — declare every table the handler writes, or reorg rollback is a no-op and orphaned rows persist forever.`,
			400,
		);
	}
	assertSqlIdentifier(checkpointTable, label);
	assertSqlIdentifier(options.height, label);
	for (const table of options.tables) assertSqlIdentifier(table, label);

	return {
		capabilities: options.capabilities,

		async loadCursor() {
			await driver.ensureCheckpointStore();
			// First-use validation of the rollback precondition: every declared
			// table must exist and carry the height column. Failing here beats a
			// rollback that silently deletes nothing during a reorg.
			for (const table of options.tables) {
				if (!(await driver.hasColumn(table, options.height))) {
					throw new ValidationError(
						`${label}: table "${table}" has no "${options.height}" column — the height stamp is what makes reorg rollback possible. Add the column (or fix \`height\`).`,
						400,
					);
				}
			}
			return driver.readCursor();
		},

		async commitBatch(cursor, write) {
			await driver.transact(async (tx) => {
				await driver.acquireLock?.(tx);
				await write(tx);
				await driver.writeCursor(tx, cursor);
			});
		},

		async rollback(forkPointHeight, rewindCursor) {
			await driver.transact(async (tx) => {
				await driver.acquireLock?.(tx);
				// INCLUSIVE of the fork block: the new canonical chain re-supplies
				// it, and the consumer rewinds to re-read from `fork:0`.
				for (const table of options.tables) {
					await driver.deleteAtOrAbove(tx, table, forkPointHeight);
				}
				await driver.writeCursor(tx, rewindCursor);
			});
		},
	};
}
