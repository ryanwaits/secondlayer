import { type Kysely, type Transaction, sql } from "kysely";
import { ValidationError } from "../errors.ts";
import type { ConsumerSink } from "./types.ts";

/**
 * Column present on EVERY declared table — `keyof` a union of row types is
 * the intersection of their keys, so a column missing from any one table is
 * a compile error at the `height:` option.
 */
type CommonColumn<DB, T extends keyof DB> = keyof DB[T] & string;

export interface KyselySinkOptions<DB, T extends keyof DB & string> {
	/** Checkpoint identity AND concurrency key: the cursor row's primary key,
	 *  and the input to `pg_try_advisory_xact_lock(hashtext(id))` — a second
	 *  consumer with the same id fails loudly instead of double-writing. */
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
	const checkpointTable = options.checkpointTable ?? "sl_consumer_checkpoints";
	if (options.tables.length === 0) {
		throw new ValidationError(
			"kyselySink: `tables` is empty — declare every table the handler writes, or reorg rollback is a no-op and orphaned rows persist forever.",
			400,
		);
	}

	/** `sql.raw`-safe identifier (we interpolate table/column names). */
	const ident = (name: string): string => {
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
			throw new ValidationError(
				`kyselySink: invalid identifier "${name}" (letters, digits, underscores only).`,
				400,
			);
		}
		return `"${name}"`;
	};
	const cp = ident(checkpointTable);
	const heightCol = ident(options.height as string);
	for (const table of options.tables) ident(table);

	async function acquireLock(tx: Transaction<DB>): Promise<void> {
		const locked = await sql<{ ok: boolean }>`
			SELECT pg_try_advisory_xact_lock(hashtext(${options.id})) AS "ok"
		`.execute(tx);
		if (!locked.rows[0]?.ok) {
			throw new ValidationError(
				`kyselySink: another consumer holds the "${options.id}" lock — two replicas of the same consumer would interleave commits. Stop the other instance or use a distinct id.`,
				409,
			);
		}
	}

	async function upsertCursor(
		tx: Transaction<DB>,
		cursor: string,
	): Promise<void> {
		// Identifiers via validated sql.raw; VALUES via bound parameters.
		await sql`
			INSERT INTO ${sql.raw(cp)} (id, cursor) VALUES (${options.id}, ${cursor})
			ON CONFLICT (id) DO UPDATE SET cursor = EXCLUDED.cursor
		`.execute(tx);
	}

	return {
		async loadCursor() {
			await sql
				.raw(
					`CREATE TABLE IF NOT EXISTS ${cp} (id text PRIMARY KEY, cursor text NOT NULL)`,
				)
				.execute(db);
			// First-use validation of the rollback precondition: every declared
			// table must exist and carry the height column. Failing here beats a
			// rollback that silently deletes nothing during a reorg.
			for (const table of options.tables) {
				const col = await sql<{ ok: boolean }>`
					SELECT EXISTS (
						SELECT 1 FROM information_schema.columns
						WHERE table_name = ${table} AND column_name = ${options.height as string}
					) AS "ok"
				`.execute(db);
				if (!col.rows[0]?.ok) {
					throw new ValidationError(
						`kyselySink: table "${table}" has no "${String(options.height)}" column — the height stamp is what makes reorg rollback possible. Add the column (or fix \`height\`).`,
						400,
					);
				}
			}
			const row = await sql<{ cursor: string }>`
				SELECT cursor FROM ${sql.raw(cp)} WHERE id = ${options.id}
			`.execute(db);
			return row.rows[0]?.cursor ?? null;
		},

		async commitBatch(cursor, write) {
			await db.transaction().execute(async (tx) => {
				await acquireLock(tx);
				await write(tx);
				await upsertCursor(tx, cursor);
			});
		},

		async rollback(forkPointHeight, rewindCursor) {
			await db.transaction().execute(async (tx) => {
				await acquireLock(tx);
				// INCLUSIVE of the fork block: the new canonical chain re-supplies
				// it, and the consumer rewinds to re-read from `fork:0`.
				for (const table of options.tables) {
					// Identifiers via validated sql.raw; the height bound as a parameter.
					await sql`
						DELETE FROM ${sql.raw(ident(table))}
						WHERE ${sql.raw(heightCol)} >= ${forkPointHeight}
					`.execute(tx);
				}
				await upsertCursor(tx, rewindCursor);
			});
		},
	};
}
