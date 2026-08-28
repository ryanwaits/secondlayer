import { type Table, getTableColumns, getTableName, sql } from "drizzle-orm";
import { ValidationError } from "../errors.ts";
import {
	DEFAULT_CHECKPOINT_TABLE,
	type SinkDriver,
	assertSqlIdentifier,
	createSink,
	quoteIdent,
} from "./core.ts";
import type { ConsumerSink } from "./types.ts";

/**
 * Structural slice of a drizzle database. Postgres databases expose
 * `execute`; sqlite databases expose `run`/`all` (sync drivers return
 * plainly, async drivers return promises — `await` absorbs both).
 */
interface DrizzleDatabaseLike {
	// biome-ignore lint/suspicious/noExplicitAny: contravariant position — must accept every concrete drizzle transaction type
	transaction(fn: (tx: any) => Promise<unknown>): Promise<unknown>;
	execute?(query: unknown): Promise<unknown>;
	run?(query: unknown): unknown;
	all?(query: unknown): unknown;
}

/** The transaction type `db.transaction` lends — what `ctx.tx` is typed as
 *  inside `onBatch` (e.g. `PgTransaction<..., TSchema>`). */
export type DrizzleTx<TDb> = TDb extends {
	// biome-ignore lint/suspicious/noExplicitAny: infer-only position
	transaction(fn: (tx: infer Tx) => any): any;
}
	? Tx
	: never;

/** Column key present on EVERY declared table — `keyof` a union of column
 *  maps is the intersection, so a key missing from any one table is a
 *  compile error at the `height:` option (same trick as kyselySink). */
type CommonColumnKey<T extends Table> = keyof T["_"]["columns"] & string;

export interface DrizzleSinkOptions<T extends Table> {
	/** Checkpoint identity AND (on Postgres) advisory-lock key. */
	id: string;
	/** Rollback scope: the drizzle table objects the handler writes. */
	tables: readonly T[];
	/** The block-height stamp column KEY (the TypeScript property, e.g.
	 *  `blockHeight` for `blockHeight: integer("block_height")`) — resolved
	 *  to each table's real SQL column name. Must exist on every declared
	 *  table; append-only projections only. */
	height: CommonColumnKey<T>;
	/** Checkpoint table name. Default `sl_consumer_checkpoints`. */
	checkpointTable?: string;
}

/**
 * A {@link ConsumerSink} over a drizzle database — Postgres or SQLite
 * dialect, detected structurally. `tables` are your schema objects, `height`
 * is compile-checked against every declared table, and `ctx.tx` inside
 * `onBatch` is the fully typed drizzle transaction for YOUR database.
 *
 * Dialect notes:
 * - Postgres (node-postgres, postgres-js, …): a per-id advisory lock makes
 *   a second replica fail loudly (contract invariant #13).
 * - SQLite (bun:sqlite, better-sqlite3): commits run under a manual
 *   `BEGIN IMMEDIATE` rather than `db.transaction()` — sync drivers would
 *   otherwise COMMIT at the handler's first `await`, silently breaking
 *   rows+cursor atomicity. `ctx.tx` is the database itself inside the open
 *   transaction. Remote/libsql drivers are NOT supported for commits (their
 *   statement-per-request model can't hold this transaction open).
 *
 * ```ts
 * const sink = drizzleSink(db, { id: "sales", tables: [sales], height: "blockHeight" });
 * await index.contractCalls.consume({
 *   contractId: MARKETPLACE, functionName: "purchase-asset", fromHeight: 0,
 *   sink,
 *   onBatch: (calls, _env, ctx) =>
 *     ctx.tx.insert(sales).values(calls.map(toSale)).onConflictDoNothing(),
 * });
 * ```
 */
export function drizzleSink<TDb extends DrizzleDatabaseLike, T extends Table>(
	db: TDb,
	options: DrizzleSinkOptions<T>,
): ConsumerSink<DrizzleTx<TDb>> {
	const checkpointTable = options.checkpointTable ?? DEFAULT_CHECKPOINT_TABLE;
	const cp = quoteIdent(checkpointTable);
	// Postgres speaks `execute`; sqlite speaks `run`/`all`.
	const isPg = typeof db.execute === "function";

	// Resolve TS column keys to real SQL names per table (they can differ:
	// `blockHeight: integer("block_height")`), and validate them here — the
	// base only validates what it's given, and it's given the resolved names.
	const heightByTable = new Map<string, string>();
	for (const table of options.tables) {
		const tableName = getTableName(table);
		const column = getTableColumns(table)[options.height];
		if (!column) {
			throw new ValidationError(
				`drizzleSink: table "${tableName}" has no "${options.height}" column key — the height stamp is what makes reorg rollback possible.`,
				400,
			);
		}
		assertSqlIdentifier(column.name, "drizzleSink");
		heightByTable.set(tableName, column.name);
	}
	const tableNames = [...heightByTable.keys()];

	/** Run a raw statement on the db or a lent tx, either dialect. */
	async function exec(
		on: DrizzleDatabaseLike,
		query: ReturnType<typeof sql>,
	): Promise<void> {
		if (isPg) await on.execute?.(query);
		else await on.run?.(query);
	}

	/** Read rows from a raw statement, either dialect. */
	async function rows(query: ReturnType<typeof sql>): Promise<unknown[]> {
		if (isPg) {
			const result = (await db.execute?.(query)) as
				| { rows?: unknown[] }
				| unknown[];
			return Array.isArray(result) ? result : (result?.rows ?? []);
		}
		return ((await db.all?.(query)) as unknown[]) ?? [];
	}

	const driver: SinkDriver<DrizzleTx<TDb>> = {
		async transact(fn) {
			if (isPg) {
				return (await db.transaction((tx: DrizzleTx<TDb>) =>
					fn(tx),
				)) as Awaited<ReturnType<typeof fn>>;
			}
			// SQLite: manual BEGIN IMMEDIATE (see dialect notes above). The
			// database itself is the lent transaction.
			await db.run?.(sql`begin immediate`);
			try {
				const result = await fn(db as unknown as DrizzleTx<TDb>);
				await db.run?.(sql`commit`);
				return result;
			} catch (err) {
				await db.run?.(sql`rollback`);
				throw err;
			}
		},

		async ensureCheckpointStore() {
			try {
				await exec(
					db,
					sql.raw(
						`CREATE TABLE IF NOT EXISTS ${cp} (id text PRIMARY KEY, cursor text NOT NULL)`,
					),
				);
			} catch (err) {
				// Concurrent first start: Postgres IF NOT EXISTS still throws
				// under a race (42P07 / 23505); either code means the table
				// exists. Drizzle may wrap the driver error, so check the cause.
				const code =
					(err as { code?: string } | null)?.code ??
					(err as { cause?: { code?: string } } | null)?.cause?.code ??
					undefined;
				if (code !== "42P07" && code !== "23505") throw err;
			}
		},

		async readCursor() {
			const found = (await rows(
				sql`SELECT cursor FROM ${sql.raw(cp)} WHERE id = ${options.id}`,
			)) as Array<{ cursor: string }>;
			return found[0]?.cursor ?? null;
		},

		async writeCursor(tx, cursor) {
			// `excluded` works in both dialects' upsert grammar.
			await exec(
				tx as unknown as DrizzleDatabaseLike,
				sql`INSERT INTO ${sql.raw(cp)} (id, cursor) VALUES (${options.id}, ${cursor}) ON CONFLICT (id) DO UPDATE SET cursor = excluded.cursor`,
			);
		},

		async clearCursor(tx) {
			await exec(
				tx as unknown as DrizzleDatabaseLike,
				sql`DELETE FROM ${sql.raw(cp)} WHERE id = ${options.id}`,
			);
		},

		async deleteAtOrAbove(tx, table, height) {
			const heightCol = heightByTable.get(table);
			if (!heightCol) return;
			await exec(
				tx as unknown as DrizzleDatabaseLike,
				sql`DELETE FROM ${sql.raw(quoteIdent(table))} WHERE ${sql.raw(quoteIdent(heightCol))} >= ${height}`,
			);
		},

		async hasColumn(table) {
			// The real SQL name was resolved from the schema object; check the
			// DATABASE carries it — schema objects prove intent, not migrations.
			const heightCol = heightByTable.get(table);
			if (!heightCol) return false;
			if (isPg) {
				const found = (await rows(
					sql`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = ${table} AND column_name = ${heightCol}) AS "ok"`,
				)) as Array<{ ok: boolean }>;
				return found[0]?.ok === true;
			}
			const found = await rows(
				sql`SELECT 1 AS ok FROM pragma_table_info(${table}) WHERE name = ${heightCol}`,
			);
			return found.length > 0;
		},

		// Postgres only: SQLite's single write lock already enforces
		// single-writer at the file level.
		...(isPg
			? {
					async acquireLock(tx: DrizzleTx<TDb>) {
						// hashtextextended (int8) rather than hashtext (int4): the
						// 32-bit space collides across distinct ids at real scale,
						// and a collision reads as a false "another consumer" 409.
						const found = (await (
							tx as unknown as DrizzleDatabaseLike
						).execute?.(
							sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${options.id}, 0)) AS "ok"`,
						)) as { rows?: Array<{ ok: boolean }> } | Array<{ ok: boolean }>;
						const row = Array.isArray(found) ? found[0] : found?.rows?.[0];
						if (row?.ok !== true) {
							throw new ValidationError(
								`drizzleSink: another consumer holds the "${options.id}" lock — two replicas of the same consumer would interleave commits. Stop the other instance or use a distinct id.`,
								409,
							);
						}
					},
				}
			: {}),
	};

	return createSink(driver, {
		label: "drizzleSink",
		id: options.id,
		tables: tableNames,
		height: options.height,
		checkpointTable,
	});
}
