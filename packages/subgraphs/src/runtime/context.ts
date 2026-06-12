import type { Database } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import { formatUnits } from "@secondlayer/stacks/utils";
import { type Kysely, type Transaction, sql } from "kysely";
import { TYPE_MAP, emitJournalDDL } from "../schema/generator.ts";
import type { ComputedValue, SubgraphSchema } from "../types.ts";

type AnyDb = Kysely<Database> | Transaction<Database>;

/** Reorg journal entries older than this many blocks are prunable — far past
 *  Stacks finality (observed reorg depth is single digits). */
export const JOURNAL_RETENTION_BLOCKS = 300;

/** Schemas whose `_journal` table existence has been ensured this process.
 *  Populated only after a successful flush (a rolled-back CREATE must retry). */
const journalEnsured = new Set<string>();

interface WriteOp {
	kind: "insert" | "update" | "delete" | "increment";
	table: string;
	data: Record<string, unknown>;
	/** For update: SET clause. For increment: column → signed delta. */
	set?: Record<string, unknown>;
}

export interface FlushWrite {
	op: "insert" | "update" | "delete";
	table: string;
	/** Full row data (for inserts) or where+set merged (for updates). Bigints stringified. */
	row: Record<string, unknown>;
	/** Stable identifier for dedup — `{blockHeight, txId, rowIndex}` */
	pk: { blockHeight: number; txId: string; rowIndex: number };
}

export interface FlushManifest {
	count: number;
	writes: FlushWrite[];
}

export interface BlockMeta {
	height: number;
	hash: string;
	timestamp: number;
	burnBlockHeight: number;
}

export interface TxMeta {
	txId: string;
	sender: string;
	type: string;
	status: string;
	contractId?: string | null;
	functionName?: string | null;
}

/** Validate that a column name is safe for SQL identifiers */
function validateColumnName(name: string): void {
	if (!/^[a-z_][a-z0-9_]*$/i.test(name)) {
		throw new Error(`Invalid column name: ${name}`);
	}
}

/**
 * Runtime context passed to subgraph handlers.
 * Batches writes and flushes them atomically at the end of a block.
 *
 * Row reads (findOne/findMany) are read-your-writes: they overlay the pending
 * ops queue on the DB state, so a handler observes every write queued earlier
 * in the same block. Without this, accumulator patterns (balance = f(existing))
 * silently lose all but the last same-block delta per row (fix-f040 B1).
 * Aggregate reads (count/sum/min/max) remain pre-flush DB state.
 */
export class SubgraphContext {
	readonly block: BlockMeta;
	private _tx: TxMeta;
	private readonly db: AnyDb;
	private readonly pgSchemaName: string;
	private readonly subgraphSchema: SubgraphSchema;
	private readonly ops: WriteOp[] = [];
	/**
	 * BYO data plane: handler writes land in a user-owned DB whose flush can't
	 * share the managed block transaction, so a crash replays the block. When
	 * set, flush() prepends a replace-per-height DELETE for every inserted table
	 * (`_block_height = N` → re-INSERT), making block reprocessing idempotent.
	 * Non-idempotent `update` handlers are rejected at deploy, not here.
	 */
	private readonly byo: boolean;
	/**
	 * Record pre-images of keyed mutations into the schema's `_journal` so a
	 * reorg can restore prior row states (fix-f040 B2). Enabled on the live
	 * path only — deep reindex/backfill heights are past finality, and the
	 * journal would just be churn the pruner deletes.
	 */
	private readonly journal: boolean;

	constructor(
		db: AnyDb,
		pgSchemaName: string,
		subgraphSchema: SubgraphSchema,
		block: BlockMeta,
		tx: TxMeta,
		byo = false,
		journal = false,
	) {
		this.db = db;
		this.pgSchemaName = pgSchemaName;
		this.subgraphSchema = subgraphSchema;
		this.block = block;
		this._tx = tx;
		this.byo = byo;
		this.journal = journal;
	}

	get tx(): TxMeta {
		return this._tx;
	}

	/** Update the current transaction context (used by runner between events) */
	setTx(tx: TxMeta): void {
		this._tx = tx;
	}

	// --- Write operations (batched) ---

	insert(table: string, row: Record<string, unknown>): void {
		this.validateTable(table);
		this.ops.push({
			kind: "insert",
			table,
			data: { ...row, _block_height: this.block.height, _tx_id: this._tx.txId },
		});
	}

	update(
		table: string,
		where: Record<string, unknown>,
		set: Record<string, unknown>,
	): void {
		this.validateTable(table);
		this.ops.push({ kind: "update", table, data: where, set });
	}

	upsert(
		table: string,
		key: Record<string, unknown>,
		row: Record<string, unknown>,
	): void {
		this.validateTable(table);
		const tableDef = this.subgraphSchema[table];
		if (!tableDef) return;
		const keyColumns = Object.keys(key);

		// Check if there's a matching uniqueKeys constraint
		const hasUniqueConstraint = tableDef.uniqueKeys?.some(
			(uk) =>
				uk.length === keyColumns.length &&
				uk.every((c) => keyColumns.includes(c)),
		);

		const meta = { _block_height: this.block.height, _tx_id: this._tx.txId };

		if (hasUniqueConstraint) {
			// Use ON CONFLICT for proper upsert
			this.ops.push({
				kind: "insert",
				table,
				data: { ...key, ...row, ...meta, _upsert_keys: keyColumns },
			});
		} else {
			// Fallback: log warning, use findOne + conditional insert/update
			logger.warn(
				"upsert called without matching uniqueKeys constraint, using fallback",
				{
					table,
					keys: keyColumns,
				},
			);
			this.ops.push({
				kind: "insert",
				table,
				data: {
					...key,
					...row,
					...meta,
					_upsert_fallback_keys: keyColumns,
					_upsert_fallback_set: row,
				},
			});
		}
	}

	delete(table: string, where: Record<string, unknown>): void {
		this.validateTable(table);
		this.ops.push({ kind: "delete", table, data: where });
	}

	/**
	 * Atomic counter update — the blessed accumulator primitive. Compiles to
	 * `INSERT ... ON CONFLICT (key) DO UPDATE SET col = COALESCE(t.col,0) + delta`,
	 * so deltas commute: same-block, replayed-in-order, and concurrent updates
	 * all land correctly without read-modify-write. Missing row inserts the
	 * delta as the initial value. Requires a uniqueKeys constraint matching
	 * `key`; deltas may be negative.
	 */
	increment(
		table: string,
		key: Record<string, unknown>,
		deltas: Record<string, bigint | number>,
	): void {
		this.validateTable(table);
		const tableDef = this.subgraphSchema[table];
		const keyColumns = Object.keys(key);
		const hasUniqueConstraint = tableDef?.uniqueKeys?.some(
			(uk) =>
				uk.length === keyColumns.length &&
				uk.every((c) => keyColumns.includes(c)),
		);
		if (!hasUniqueConstraint) {
			throw new Error(
				`increment("${table}") requires a uniqueKeys constraint on [${keyColumns.join(", ")}]`,
			);
		}
		for (const [col, v] of Object.entries(deltas)) {
			validateColumnName(col);
			if (keyColumns.includes(col)) {
				throw new Error(`increment("${table}"): "${col}" is a key column`);
			}
			if (typeof v !== "bigint" && typeof v !== "number") {
				throw new Error(
					`increment("${table}"): delta for "${col}" must be bigint or number`,
				);
			}
		}
		this.ops.push({
			kind: "increment",
			table,
			data: {
				...key,
				_block_height: this.block.height,
				_tx_id: this._tx.txId,
				_upsert_keys: keyColumns,
			},
			set: { ...deltas },
		});
	}

	// --- Ops checkpoint (per-event atomicity) ---

	/** Current length of the pending-ops queue. Pair with {@link rollbackTo}. */
	opsCheckpoint(): number {
		return this.ops.length;
	}

	/**
	 * Discard ops queued after a checkpoint. The runner wraps each handler
	 * invocation so a thrown handler contributes nothing — without this, a
	 * transfer handler that debited then threw flushes a one-sided debit
	 * (fix-f040 B6).
	 */
	rollbackTo(checkpoint: number): void {
		if (checkpoint < 0 || checkpoint > this.ops.length) return;
		this.ops.length = checkpoint;
	}

	/** Partial update — sets only specified fields, preserves everything else */
	patch(
		table: string,
		where: Record<string, unknown>,
		set: Record<string, unknown>,
	): void {
		this.update(table, where, set);
	}

	/**
	 * Find-then-merge-or-insert. Values can be functions: (existing) => newValue.
	 * Async because it reads existing row first.
	 */
	async patchOrInsert(
		table: string,
		key: Record<string, unknown>,
		row: Record<string, ComputedValue>,
	): Promise<void> {
		const existing = await this.findOne(table, key);
		const resolved: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(row)) {
			resolved[k] = typeof v === "function" ? v(existing) : v;
		}
		this.upsert(table, key, resolved);
	}

	/** Format a bigint amount with decimal places */
	formatUnits(value: bigint, decimals: number): string {
		return formatUnits(value, decimals);
	}

	// --- Read operations (immediate) ---

	async findOne(
		table: string,
		where: Record<string, unknown>,
	): Promise<Record<string, unknown> | null> {
		this.validateTable(table);
		const qualifiedTable = `"${this.pgSchemaName}"."${table}"`;
		const { clause } = buildWhereClause(where);
		const query = `SELECT * FROM ${qualifiedTable} WHERE ${clause} LIMIT 1`;
		const { rows } = await sql.raw(query).execute(this.db);
		const row = (rows as Record<string, unknown>[])[0] ?? null;
		return this.overlayOne(
			table,
			where,
			row ? this.coerceRow(table, row) : null,
		);
	}

	async findMany(
		table: string,
		where: Record<string, unknown>,
	): Promise<Record<string, unknown>[]> {
		this.validateTable(table);
		const qualifiedTable = `"${this.pgSchemaName}"."${table}"`;
		const { clause } = buildWhereClause(where);
		const query = `SELECT * FROM ${qualifiedTable} WHERE ${clause}`;
		const { rows } = await sql.raw(query).execute(this.db);
		const dbRows = (rows as Record<string, unknown>[]).map((r) =>
			this.coerceRow(table, r),
		);
		return this.overlayMany(table, where, dbRows);
	}

	// --- Pending-ops overlay (read-your-writes) ---

	/**
	 * Replay pending ops for `table` over a single DB-read result so reads
	 * observe earlier same-block writes. Mirrors flush semantics: upserts
	 * merge non-key/non-meta columns, increments add deltas, updates/deletes
	 * apply by where-match. Overlaid rows synthesized from pending inserts
	 * lack DB-generated columns (_id, _created_at).
	 */
	private overlayOne(
		table: string,
		where: Record<string, unknown>,
		dbRow: Record<string, unknown> | null,
	): Record<string, unknown> | null {
		let row = dbRow;
		for (const op of this.ops) {
			if (op.table !== table) continue;
			row = this.applyOpToRow(op, row, where);
		}
		return row;
	}

	private overlayMany(
		table: string,
		where: Record<string, unknown>,
		dbRows: Record<string, unknown>[],
	): Record<string, unknown>[] {
		let result = [...dbRows];
		for (const op of this.ops) {
			if (op.table !== table) continue;
			if (op.kind === "update") {
				result = result.map((r) =>
					rowMatches(r, op.data) ? { ...r, ...(op.set ?? {}) } : r,
				);
			} else if (op.kind === "delete") {
				result = result.filter((r) => !rowMatches(r, op.data));
			} else {
				// insert / increment — merge into the keyed row, or append if the
				// new row satisfies the filter.
				const upsertKeys = op.data._upsert_keys as string[] | undefined;
				const clean = stripControlKeys(op.data);
				const idx = upsertKeys
					? result.findIndex((r) =>
							upsertKeys.every((k) => valEq(r[k], clean[k])),
						)
					: -1;
				if (idx >= 0) {
					// biome-ignore lint/style/noNonNullAssertion: idx bounds-checked
					result[idx] =
						this.applyOpToRow(op, result[idx]!, where) ?? result[idx]!;
				} else {
					const created = this.applyOpToRow(op, null, where);
					if (created) result.push(created);
				}
			}
		}
		return result;
	}

	/** Apply one pending op to a candidate row state (null = row absent). */
	private applyOpToRow(
		op: WriteOp,
		row: Record<string, unknown> | null,
		where: Record<string, unknown>,
	): Record<string, unknown> | null {
		const upsertKeys = op.data._upsert_keys as string[] | undefined;
		const clean = stripControlKeys(op.data);

		switch (op.kind) {
			case "insert": {
				if (row) {
					// Same entity? Compare on the upsert key — a plain insert (no
					// key) can never target an existing row.
					if (upsertKeys?.every((k) => valEq(row[k], clean[k]))) {
						// Mirror ON CONFLICT DO UPDATE: non-key, non-meta cols only.
						const merged = { ...row };
						for (const [k, v] of Object.entries(clean)) {
							if (!upsertKeys.includes(k) && !k.startsWith("_")) merged[k] = v;
						}
						return merged;
					}
					return row;
				}
				return rowMatches(clean, where) ? { ...clean } : null;
			}
			case "increment": {
				const deltas = op.set ?? {};
				if (row) {
					// biome-ignore lint/style/noNonNullAssertion: increment always carries _upsert_keys
					if (upsertKeys!.every((k) => valEq(row[k], clean[k]))) {
						const merged = { ...row };
						for (const [col, d] of Object.entries(deltas)) {
							merged[col] = toBigIntOr0(merged[col]) + toBigIntOr0(d);
						}
						return merged;
					}
					return row;
				}
				if (!rowMatches(clean, where)) return null;
				const created: Record<string, unknown> = { ...clean };
				for (const [col, d] of Object.entries(deltas)) {
					created[col] = toBigIntOr0(d);
				}
				return created;
			}
			case "update":
				return row && rowMatches(row, op.data)
					? { ...row, ...(op.set ?? {}) }
					: row;
			case "delete":
				return row && rowMatches(row, op.data) ? null : row;
		}
	}

	// --- Aggregate reads ---

	async count(table: string, where?: Record<string, unknown>): Promise<number> {
		this.validateTable(table);
		const qualifiedTable = `"${this.pgSchemaName}"."${table}"`;
		const whereClause = where ? `WHERE ${buildWhereClause(where).clause}` : "";
		const { rows } = await sql
			.raw(
				`SELECT COUNT(*)::int AS count FROM ${qualifiedTable} ${whereClause}`,
			)
			.execute(this.db);
		return Number((rows as Record<string, unknown>[])[0]?.count ?? 0);
	}

	async sum(
		table: string,
		column: string,
		where?: Record<string, unknown>,
	): Promise<bigint> {
		this.validateTable(table);
		validateColumnName(column);
		const qualifiedTable = `"${this.pgSchemaName}"."${table}"`;
		const whereClause = where ? `WHERE ${buildWhereClause(where).clause}` : "";
		const { rows } = await sql
			.raw(
				`SELECT COALESCE(SUM("${column}"), 0) AS total FROM ${qualifiedTable} ${whereClause}`,
			)
			.execute(this.db);
		return BigInt(
			(rows as Record<string, unknown>[])[0]?.total?.toString() ?? "0",
		);
	}

	async min(
		table: string,
		column: string,
		where?: Record<string, unknown>,
	): Promise<bigint | null> {
		this.validateTable(table);
		validateColumnName(column);
		const qualifiedTable = `"${this.pgSchemaName}"."${table}"`;
		const whereClause = where ? `WHERE ${buildWhereClause(where).clause}` : "";
		const { rows } = await sql
			.raw(
				`SELECT MIN("${column}") AS val FROM ${qualifiedTable} ${whereClause}`,
			)
			.execute(this.db);
		const val = (rows as Record<string, unknown>[])[0]?.val;
		return val != null ? BigInt(val.toString()) : null;
	}

	async max(
		table: string,
		column: string,
		where?: Record<string, unknown>,
	): Promise<bigint | null> {
		this.validateTable(table);
		validateColumnName(column);
		const qualifiedTable = `"${this.pgSchemaName}"."${table}"`;
		const whereClause = where ? `WHERE ${buildWhereClause(where).clause}` : "";
		const { rows } = await sql
			.raw(
				`SELECT MAX("${column}") AS val FROM ${qualifiedTable} ${whereClause}`,
			)
			.execute(this.db);
		const val = (rows as Record<string, unknown>[])[0]?.val;
		return val != null ? BigInt(val.toString()) : null;
	}

	async countDistinct(
		table: string,
		column: string,
		where?: Record<string, unknown>,
	): Promise<number> {
		this.validateTable(table);
		validateColumnName(column);
		const qualifiedTable = `"${this.pgSchemaName}"."${table}"`;
		const whereClause = where ? `WHERE ${buildWhereClause(where).clause}` : "";
		const { rows } = await sql
			.raw(
				`SELECT COUNT(DISTINCT "${column}")::int AS count FROM ${qualifiedTable} ${whereClause}`,
			)
			.execute(this.db);
		return Number((rows as Record<string, unknown>[])[0]?.count ?? 0);
	}

	/** Coerce string values from Postgres back to BigInt for uint/int columns */
	private coerceRow(
		table: string,
		row: Record<string, unknown>,
	): Record<string, unknown> {
		const tableDef = this.subgraphSchema[table];
		if (!tableDef) return row;
		const result = { ...row };
		for (const [col, def] of Object.entries(tableDef.columns)) {
			if (
				(def.type === "uint" || def.type === "int") &&
				typeof result[col] === "string"
			) {
				result[col] = BigInt(result[col] as string);
			}
		}
		return result;
	}

	// --- Flush ---

	/** Number of pending write operations */
	get pendingOps(): number {
		return this.ops.length;
	}

	/**
	 * Execute all batched writes in a single transaction.
	 * Auto-populates _block_height, _tx_id, _created_at on inserts.
	 *
	 * Returns a {@link FlushManifest} describing every write so downstream
	 * consumers (subscription emitter) can fan out outbox rows atomically
	 * with the flush itself.
	 */
	async flush(): Promise<FlushManifest> {
		if (this.ops.length === 0) return { count: 0, writes: [] };

		await this.ensureJournalTable();

		const opsToFlush = [...this.ops];
		this.ops.length = 0;

		const statements = this.buildStatements(opsToFlush);

		if ("isTransaction" in this.db) {
			for (const stmt of statements) {
				await sql.raw(stmt).execute(this.db);
			}
		} else {
			await (this.db as Kysely<Database>).transaction().execute(async (tx) => {
				for (const stmt of statements) {
					await sql.raw(stmt).execute(tx);
				}
			});
		}

		const writes: FlushWrite[] = opsToFlush.map((op, rowIndex) => {
			const blockHeight =
				(op.data._block_height as number | undefined) ?? this.block.height;
			const txId = (op.data._tx_id as string | undefined) ?? this._tx.txId;
			const baseRow =
				op.kind === "update" || op.kind === "increment"
					? { ...op.data, ...(op.set ?? {}) }
					: { ...op.data };
			// Strip upsert control keys — not part of the row shape
			(baseRow as Record<string, unknown>)._upsert_keys = undefined;
			(baseRow as Record<string, unknown>)._upsert_fallback_keys = undefined;
			(baseRow as Record<string, unknown>)._upsert_fallback_set = undefined;
			return {
				// Increments surface as "updated" to subscribers — the row payload
				// carries the key + the applied delta, not the absolute value.
				op: op.kind === "increment" ? "update" : op.kind,
				table: op.table,
				row: jsonSafe(baseRow),
				pk: { blockHeight, txId, rowIndex },
			};
		});

		return { count: opsToFlush.length, writes };
	}

	/** Prepare a single insert row, returning its data, columns, upsert key for batching. */
	private prepareInsert(op: WriteOp): {
		data: Record<string, unknown>;
		cols: string[];
		vals: string[];
		upsertKeys: string[] | undefined;
		batchKey: string;
	} {
		const upsertKeys = op.data._upsert_keys as string[] | undefined;
		const data = { ...op.data };
		// biome-ignore lint/performance/noDelete: must remove key, not set undefined — Object.keys must not include these
		delete data._upsert_keys;
		// biome-ignore lint/performance/noDelete: same as above
		delete data._upsert_fallback_keys;
		// biome-ignore lint/performance/noDelete: same as above
		delete data._upsert_fallback_set;

		// _block_height and _tx_id are captured at insert/upsert time (not flush time)
		// to ensure correct tx attribution when multiple txs are batched per block
		if (!data._block_height) data._block_height = this.block.height;
		if (!data._tx_id) data._tx_id = this._tx.txId;
		data._created_at = "NOW()";

		const cols = Object.keys(data);
		cols.forEach(validateColumnName);
		const vals = cols.map((c) =>
			data[c] === "NOW()" ? "NOW()" : escapeLiteral(data[c]),
		);

		// Batch key: table + sorted columns + upsert key signature (spread to avoid mutating cols)
		const batchKey = `${op.table}:${[...cols].sort().join(",")}:${upsertKeys ? [...upsertKeys].sort().join(",") : ""}`;

		return { data, cols, vals, upsertKeys, batchKey };
	}

	/**
	 * Lazily create `_journal` for schemas deployed before it existed. Cached
	 * per process only once CONFIRMED present (to_regclass) — a CREATE issued
	 * inside a block tx could roll back with it, so self-created tables are
	 * re-verified on the next flush instead of trusted.
	 */
	private async ensureJournalTable(): Promise<void> {
		if (!this.journal || journalEnsured.has(this.pgSchemaName)) return;
		const { rows } = await sql
			.raw(`SELECT to_regclass('"${this.pgSchemaName}"."_journal"') AS r`)
			.execute(this.db);
		if ((rows as { r: unknown }[])[0]?.r) {
			journalEnsured.add(this.pgSchemaName);
			return;
		}
		// Schema names are generator-produced lowercase identifiers, so the
		// unquoted form emitJournalDDL emits is safe.
		for (const stmt of emitJournalDDL(this.pgSchemaName)) {
			await sql.raw(stmt).execute(this.db);
		}
	}

	/** SQL type of a user column (for casting journal key VALUES), if known. */
	private columnSqlType(table: string, col: string): string | undefined {
		const def = this.subgraphSchema[table]?.columns?.[col];
		return def ? TYPE_MAP[def.type] : undefined;
	}

	/**
	 * Journal pre-images for a keyed batch: one `_journal` row per key with the
	 * row's current state (`prev_row`), or NULL when the key doesn't exist yet
	 * (the mutation will create it — a revert deletes it). Emitted BEFORE the
	 * mutation statement, same transaction.
	 */
	private journalCaptureSQL(
		table: string,
		keyCols: string[],
		/** One escaped-literal tuple per key, ordered like keyCols. */
		keyLiteralRows: string[][],
	): string {
		const cast = (col: string, expr: string) => {
			const t = this.columnSqlType(table, col);
			return t ? `CAST(${expr} AS ${t})` : expr;
		};
		const keyObj = keyCols
			.map((k) => `'${k}', ${cast(k, `v."${k}"`)}`)
			.join(", ");
		const joinCond = keyCols
			.map((k) => `t."${k}" = ${cast(k, `v."${k}"`)}`)
			.join(" AND ");
		const valuesList = keyLiteralRows
			.map((r) => `(${r.join(", ")})`)
			.join(", ");
		return (
			`INSERT INTO "${this.pgSchemaName}"."_journal" ("block_height", "table_name", "row_key", "prev_row") ` +
			`SELECT ${this.block.height}, '${table}', jsonb_build_object(${keyObj}), to_jsonb(t.*) ` +
			`FROM (VALUES ${valuesList}) AS v(${keyCols.map((k) => `"${k}"`).join(", ")}) ` +
			`LEFT JOIN "${this.pgSchemaName}"."${table}" t ON ${joinCond}`
		);
	}

	/** Journal pre-images of rows a where-clause mutation will touch, keyed by `_id`. */
	private journalCaptureByWhereSQL(table: string, clause: string): string {
		return (
			`INSERT INTO "${this.pgSchemaName}"."_journal" ("block_height", "table_name", "row_key", "prev_row") ` +
			`SELECT ${this.block.height}, '${table}', jsonb_build_object('_id', t."_id"), to_jsonb(t.*) ` +
			`FROM "${this.pgSchemaName}"."${table}" t WHERE ${clause}`
		);
	}

	/** Build SQL statements from write ops, batching compatible INSERTs. */
	private buildStatements(ops: WriteOp[]): string[] {
		const statements: string[] = [];

		// BYO replace-per-height: clear this block's prior inserts before
		// re-inserting so a replayed block (no cross-DB tx) stays idempotent.
		// One DELETE per distinct inserted table; upserts/updates self-heal.
		if (this.byo) {
			const insertTables = new Set<string>();
			for (const op of ops)
				if (op.kind === "insert") insertTables.add(op.table);
			for (const table of insertTables) {
				statements.push(
					`DELETE FROM "${this.pgSchemaName}"."${table}" WHERE "_block_height" = ${this.block.height}`,
				);
			}
		}

		// Group consecutive inserts by batch key
		type InsertBatch = {
			table: string;
			cols: string[];
			rows: string[][];
			upsertKeys: string[] | undefined;
		};

		// Consecutive increments on the same (table, key cols, delta cols)
		// coalesce: same-key deltas SUM (they commute), then compile to one
		// multi-row INSERT ... ON CONFLICT DO UPDATE SET c = COALESCE(c,0)+EXCLUDED.c.
		type IncrementBatch = {
			table: string;
			keyCols: string[];
			deltaCols: string[];
			/** key signature → { key values, summed deltas, insert-time meta } */
			rows: Map<
				string,
				{
					keys: Record<string, unknown>;
					deltas: Record<string, bigint>;
					meta: { blockHeight: unknown; txId: unknown };
				}
			>;
		};

		let currentBatch: InsertBatch | null = null;
		let currentBatchKey = "";
		let incBatch: IncrementBatch | null = null;
		let incBatchKey = "";

		const flushIncrementBatch = () => {
			if (!incBatch) return;
			const batch = incBatch;
			const qualifiedTable = `"${this.pgSchemaName}"."${batch.table}"`;
			const cols = [
				...batch.keyCols,
				...batch.deltaCols,
				"_block_height",
				"_tx_id",
				"_created_at",
			];
			const valuesList = Array.from(batch.rows.values())
				.map((r) => {
					const vals = [
						...batch.keyCols.map((k) => escapeLiteral(r.keys[k])),
						...batch.deltaCols.map((c) => String(r.deltas[c] ?? 0n)),
						escapeLiteral(r.meta.blockHeight),
						escapeLiteral(r.meta.txId),
						"NOW()",
					];
					return `(${vals.join(", ")})`;
				})
				.join(", ");
			const setClauses = batch.deltaCols.map(
				(c) =>
					`"${c}" = COALESCE("${batch.table}"."${c}", 0) + EXCLUDED."${c}"`,
			);
			if (this.journal) {
				statements.push(
					this.journalCaptureSQL(
						batch.table,
						batch.keyCols,
						Array.from(batch.rows.values()).map((r) =>
							batch.keyCols.map((k) => escapeLiteral(r.keys[k])),
						),
					),
				);
			}
			statements.push(
				`INSERT INTO ${qualifiedTable} (${cols.map((c) => `"${c}"`).join(", ")}) VALUES ${valuesList} ` +
					`ON CONFLICT (${batch.keyCols.map((k) => `"${k}"`).join(", ")}) DO UPDATE SET ${setClauses.join(", ")}`,
			);
			incBatch = null;
			incBatchKey = "";
		};

		const flushInsertBatch = () => {
			if (!currentBatch) return;
			const batch = currentBatch;
			const qualifiedTable = `"${this.pgSchemaName}"."${batch.table}"`;
			const colList = batch.cols.map((c) => `"${c}"`).join(", ");

			// Deduplicate by upsert key — last row wins (Postgres rejects duplicate keys in one INSERT)
			let rows = batch.rows;
			if (batch.upsertKeys && batch.upsertKeys.length > 0) {
				const uKeys = batch.upsertKeys;
				const keyIndices = uKeys.map((k) => batch.cols.indexOf(k));
				const seen = new Map<string, number>();
				for (let i = 0; i < rows.length; i++) {
					const key = keyIndices.map((ki) => rows[i][ki]).join("\0");
					seen.set(key, i);
				}
				if (seen.size < rows.length) {
					rows = Array.from(seen.values()).map((i) => rows[i]);
				}
			}

			const valuesList = rows.map((r) => `(${r.join(", ")})`).join(", ");
			let stmt = `INSERT INTO ${qualifiedTable} (${colList}) VALUES ${valuesList}`;

			// Plain inserts are append-only (revert = delete by _block_height);
			// only keyed upserts can overwrite state worth journaling.
			if (this.journal && batch.upsertKeys && batch.upsertKeys.length > 0) {
				const uKeys = batch.upsertKeys;
				const keyIndices = uKeys.map((k) => batch.cols.indexOf(k));
				statements.push(
					this.journalCaptureSQL(
						batch.table,
						uKeys,
						rows.map((r) => keyIndices.map((ki) => r[ki])),
					),
				);
			}

			if (batch.upsertKeys && batch.upsertKeys.length > 0) {
				const batchKeys = batch.upsertKeys;
				const updateCols = batch.cols.filter(
					(c) => !batchKeys.includes(c) && !c.startsWith("_"),
				);
				if (updateCols.length > 0) {
					const setClauses = updateCols.map((c) => `"${c}" = EXCLUDED."${c}"`);
					stmt += ` ON CONFLICT (${batchKeys.map((k) => `"${k}"`).join(", ")}) DO UPDATE SET ${setClauses.join(", ")}`;
				} else {
					stmt += ` ON CONFLICT (${batchKeys.map((k) => `"${k}"`).join(", ")}) DO NOTHING`;
				}
			}

			statements.push(stmt);
			currentBatch = null;
			currentBatchKey = "";
		};

		for (const op of ops) {
			const qualifiedTable = `"${this.pgSchemaName}"."${op.table}"`;

			if (op.kind === "insert") {
				flushIncrementBatch();
				const { cols, vals, upsertKeys, batchKey } = this.prepareInsert(op);

				if (batchKey === currentBatchKey && currentBatch) {
					// Same table + columns + upsert key — append to batch
					currentBatch.rows.push(vals);
				} else {
					// Different batch — flush previous and start new
					flushInsertBatch();
					currentBatch = { table: op.table, cols, rows: [vals], upsertKeys };
					currentBatchKey = batchKey;
				}
			} else if (op.kind === "increment") {
				flushInsertBatch();
				const keyCols = [...(op.data._upsert_keys as string[])].sort();
				const deltaCols = Object.keys(op.set ?? {}).sort();
				const batchKey = `inc:${op.table}:${keyCols.join(",")}:${deltaCols.join(",")}`;
				if (batchKey !== incBatchKey || !incBatch) {
					flushIncrementBatch();
					incBatch = { table: op.table, keyCols, deltaCols, rows: new Map() };
					incBatchKey = batchKey;
				}
				const clean = stripControlKeys(op.data);
				const keySig = keyCols.map((k) => escapeLiteral(clean[k])).join("\0");
				const existing = incBatch.rows.get(keySig);
				if (existing) {
					for (const c of deltaCols) {
						existing.deltas[c] =
							(existing.deltas[c] ?? 0n) + toBigIntOr0(op.set?.[c]);
					}
				} else {
					const deltas: Record<string, bigint> = {};
					for (const c of deltaCols) deltas[c] = toBigIntOr0(op.set?.[c]);
					incBatch.rows.set(keySig, {
						keys: clean,
						deltas,
						meta: {
							blockHeight: op.data._block_height ?? this.block.height,
							txId: op.data._tx_id ?? this._tx.txId,
						},
					});
				}
			} else {
				// Non-insert — flush any pending batches first
				flushInsertBatch();
				flushIncrementBatch();

				if (op.kind === "update") {
					const setEntries = Object.entries(op.set ?? {});
					for (const [k] of setEntries) validateColumnName(k);
					const setClauses = setEntries.map(
						([k, v]) => `"${k}" = ${escapeLiteral(v)}`,
					);
					const { clause } = buildWhereClause(op.data);
					if (this.journal) {
						statements.push(this.journalCaptureByWhereSQL(op.table, clause));
					}
					statements.push(
						`UPDATE ${qualifiedTable} SET ${setClauses.join(", ")} WHERE ${clause}`,
					);
				} else if (op.kind === "delete") {
					const { clause } = buildWhereClause(op.data);
					if (this.journal) {
						statements.push(this.journalCaptureByWhereSQL(op.table, clause));
					}
					statements.push(`DELETE FROM ${qualifiedTable} WHERE ${clause}`);
				}
			}
		}

		// Flush any remaining batches
		flushInsertBatch();
		flushIncrementBatch();

		return statements;
	}

	private validateTable(table: string): void {
		if (!this.subgraphSchema[table]) {
			throw new Error(
				`Table "${table}" not found in subgraph schema. Available: [${Object.keys(this.subgraphSchema).join(", ")}]`,
			);
		}
	}
}

// --- Helpers ---

/** Drop internal upsert control keys from an op's data. */
function stripControlKeys(
	data: Record<string, unknown>,
): Record<string, unknown> {
	const {
		_upsert_keys: _a,
		_upsert_fallback_keys: _b,
		_upsert_fallback_set: _c,
		...clean
	} = data;
	return clean;
}

/** Loose value equality across bigint/number/string representations. */
function valEq(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (a == null || b == null) return false;
	return String(a) === String(b);
}

/** Does `row` satisfy every column constraint in `where`? */
function rowMatches(
	row: Record<string, unknown>,
	where: Record<string, unknown>,
): boolean {
	return Object.entries(where).every(([k, v]) => valEq(row[k], v));
}

function toBigIntOr0(v: unknown): bigint {
	if (typeof v === "bigint") return v;
	if (v == null) return 0n;
	try {
		return BigInt(String(v));
	} catch {
		return 0n;
	}
}

/** Coerce a row for JSON serialization — bigints become strings. */
function jsonSafe(row: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(row)) {
		out[k] = typeof v === "bigint" ? v.toString() : v;
	}
	return out;
}

function escapeLiteral(value: unknown): string {
	if (value === null || value === undefined) return "NULL";
	if (typeof value === "number" || typeof value === "bigint")
		return String(value);
	if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
	if (typeof value === "object")
		return `'${JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)).replace(/'/g, "''")}'::jsonb`;
	// String — escape single quotes
	return `'${String(value).replace(/'/g, "''")}'`;
}

function buildWhereClause(where: Record<string, unknown>): {
	clause: string;
	values: unknown[];
} {
	const entries = Object.entries(where);
	if (entries.length === 0) return { clause: "TRUE", values: [] };

	for (const [k] of entries) validateColumnName(k);
	const parts = entries.map(([k, v]) => `"${k}" = ${escapeLiteral(v)}`);
	return { clause: parts.join(" AND "), values: [] };
}
