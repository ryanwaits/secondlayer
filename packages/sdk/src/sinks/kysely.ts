import { type Kysely, type Transaction, sql } from "kysely";
import { ValidationError } from "../errors.ts";
import {
	DEFAULT_CHECKPOINT_TABLE,
	type SinkDriver,
	createSink,
	quoteIdent,
} from "./core.ts";
import type { ConsumerSink } from "./types.ts";

/**
 * Column present on EVERY declared table — `keyof` a union of row types is
 * the intersection of their keys, so a column missing from any one table is
 * a compile error at the `height:` option.
 */
type CommonColumn<DB, T extends keyof DB> = keyof DB[T] & string;

export interface KyselySinkOptions<DB, T extends keyof DB & string> {
	/** Checkpoint identity AND concurrency key: the cursor row's primary key,
	 *  and the input to `pg_try_advisory_xact_lock(hashtextextended(id, 0))`.
	 *  The lock is transaction-scoped: it stops two replicas from
	 *  INTERLEAVING inside a commit, but is released at each commit boundary
	 *  — it is NOT a fence, so two replicas alternating batches both pass.
	 *  Run exactly one consumer per id; the lock turns the racy overlap loud,
	 *  it does not make a second replica safe. */
	id: string;
	/** Rollback scope. On a reorg, rows AT OR ABOVE the fork point are deleted
	 *  from exactly these tables (inclusive `>=` — the new chain re-supplies
	 *  the fork block). A table you write but don't declare keeps orphaned
	 *  rows forever, so declare everything the handler touches. */
	tables: readonly T[];
	/** The block-height stamp column, present on every declared table (compile
	 *  and first-use checked). Height-stamp rollback is correct for
	 *  APPEND-ONLY projections (one row per event/call); aggregates that
	 *  mutate rows (balances, counters) can't be rolled back this way — use a
	 *  subgraph for those. */
	height: CommonColumn<DB, T>;
	/** Checkpoint table name. Default `sl_consumer_checkpoints` (created on
	 *  first use). */
	checkpointTable?: string;
}

/**
 * A {@link ConsumerSink} over a Kysely Postgres database — keyed on the
 * QUERY BUILDER (not the driver) so the `DB` schema generic flows through:
 * `tables` is `(keyof DB)[]`, `height` must exist on every declared table,
 * and `ctx.tx` inside `onBatch` is a fully typed `Transaction<DB>`.
 *
 * What it owns (so your indexer doesn't):
 * - the checkpoint table + cursor load on start;
 * - rows AND cursor committed in ONE transaction per batch — a handler
 *   throw aborts both, so a crashed batch is re-read on restart with no
 *   gaps and no double-writes;
 * - reorg rollback: delete `>= fork_point_height` from every declared table
 *   and commit the rewound cursor atomically (the crash-between-the-two-
 *   writes gap is unrepresentable);
 * - a per-id advisory lock, so two replicas of the same consumer can't
 *   interleave commits.
 *
 * Structurally it is a 7-method {@link SinkDriver} on the shared
 * `createSink` base (`@secondlayer/sdk/sinks/core`), which owns the
 * transaction sequences and guards — this file only knows how to speak
 * Postgres-flavored Kysely.
 *
 * ```ts
 * const sink = kyselySink(db, { id: "sales", tables: ["sales"], height: "block_height" });
 * await index.contractCalls.consume({
 *   contractId: MARKETPLACE, functionName: "purchase-asset", fromHeight: 0,
 *   sink,
 *   onBatch: (calls, _env, ctx) =>
 *     ctx.tx.insertInto("sales").values(calls.map(toSale)).execute(),
 * });
 * ```
 */
export function kyselySink<DB, T extends keyof DB & string>(
	db: Kysely<DB>,
	options: KyselySinkOptions<DB, T>,
): ConsumerSink<Transaction<DB>> {
	const checkpointTable = options.checkpointTable ?? DEFAULT_CHECKPOINT_TABLE;
	const cp = quoteIdent(checkpointTable);

	const driver: SinkDriver<Transaction<DB>> = {
		transact: (fn) => db.transaction().execute(fn),

		async ensureCheckpointStore() {
			try {
				await sql
					.raw(
						`CREATE TABLE IF NOT EXISTS ${cp} (id text PRIMARY KEY, cursor text NOT NULL)`,
					)
					.execute(db);
			} catch (err) {
				// Two consumers racing the same first start: IF NOT EXISTS still
				// throws under concurrency (42P07 duplicate_table, or 23505 on the
				// pg_type catalog). Either way the table exists — the outcome we
				// were creating.
				const code = (err as { code?: string } | null)?.code;
				if (code !== "42P07" && code !== "23505") throw err;
			}
		},

		async readCursor() {
			const row = await sql<{ cursor: string }>`
				SELECT cursor FROM ${sql.raw(cp)} WHERE id = ${options.id}
			`.execute(db);
			return row.rows[0]?.cursor ?? null;
		},

		async writeCursor(tx, cursor) {
			// Identifiers via validated sql.raw; VALUES via bound parameters.
			await sql`
				INSERT INTO ${sql.raw(cp)} (id, cursor) VALUES (${options.id}, ${cursor})
				ON CONFLICT (id) DO UPDATE SET cursor = EXCLUDED.cursor
			`.execute(tx);
		},

		async deleteAtOrAbove(tx, table, height) {
			// Identifiers via validated sql.raw; the height bound as a parameter.
			await sql`
				DELETE FROM ${sql.raw(quoteIdent(table))}
				WHERE ${sql.raw(quoteIdent(options.height as string))} >= ${height}
			`.execute(tx);
		},

		async hasColumn(table, column) {
			const col = await sql<{ ok: boolean }>`
				SELECT EXISTS (
					SELECT 1 FROM information_schema.columns
					WHERE table_name = ${table} AND column_name = ${column}
				) AS "ok"
			`.execute(db);
			return col.rows[0]?.ok ?? false;
		},

		async acquireLock(tx) {
			// hashtextextended (int8), not hashtext (int4): the 32-bit space
			// collides across distinct ids at real scale, and a collision reads
			// as a false "another consumer" 409 between unrelated sinks.
			const locked = await sql<{ ok: boolean }>`
				SELECT pg_try_advisory_xact_lock(hashtextextended(${options.id}, 0)) AS "ok"
			`.execute(tx);
			if (!locked.rows[0]?.ok) {
				throw new ValidationError(
					`kyselySink: another consumer holds the "${options.id}" lock — two replicas of the same consumer would interleave commits. Stop the other instance or use a distinct id.`,
					409,
				);
			}
		},
	};

	return createSink(driver, {
		label: "kyselySink",
		id: options.id,
		tables: options.tables,
		height: options.height as string,
		checkpointTable,
	});
}
