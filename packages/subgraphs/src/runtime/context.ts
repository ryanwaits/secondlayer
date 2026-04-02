import type { Database } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import { formatUnits } from "@secondlayer/stacks/utils";
import { type Kysely, type Transaction, sql } from "kysely";
import type { ComputedValue, SubgraphSchema } from "../types.ts";

type AnyDb = Kysely<Database> | Transaction<Database>;

interface WriteOp {
	kind: "insert" | "update" | "delete";
	table: string;
	data: Record<string, unknown>;
	/** For update: SET clause */
	set?: Record<string, unknown>;
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
 * Reads execute immediately against the DB (pre-flush state).
 */
export class SubgraphContext {
	readonly block: BlockMeta;
	private _tx: TxMeta;
	private readonly db: AnyDb;
	private readonly pgSchemaName: string;
	private readonly subgraphSchema: SubgraphSchema;
	private readonly ops: WriteOp[] = [];

	constructor(
		db: AnyDb,
		pgSchemaName: string,
		subgraphSchema: SubgraphSchema,
		block: BlockMeta,
		tx: TxMeta,
	) {
		this.db = db;
		this.pgSchemaName = pgSchemaName;
		this.subgraphSchema = subgraphSchema;
		this.block = block;
		this._tx = tx;
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
		this.ops.push({ kind: "insert", table, data: row });
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
		const tableDef = this.subgraphSchema[table]!;
		const keyColumns = Object.keys(key);

		// Check if there's a matching uniqueKeys constraint
		const hasUniqueConstraint = tableDef.uniqueKeys?.some(
			(uk) =>
				uk.length === keyColumns.length &&
				uk.every((c) => keyColumns.includes(c)),
		);

		if (hasUniqueConstraint) {
			// Use ON CONFLICT for proper upsert
			this.ops.push({
				kind: "insert",
				table,
				data: { ...key, ...row, _upsert_keys: keyColumns },
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
		return row ? this.coerceRow(table, row) : null;
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
		return (rows as Record<string, unknown>[]).map((r) =>
			this.coerceRow(table, r),
		);
	}

	// --- Aggregate reads ---

	async count(
		table: string,
		where?: Record<string, unknown>,
	): Promise<number> {
		this.validateTable(table);
		const qualifiedTable = `"${this.pgSchemaName}"."${table}"`;
		const whereClause = where
			? `WHERE ${buildWhereClause(where).clause}`
			: "";
		const { rows } = await sql
			.raw(`SELECT COUNT(*)::int AS count FROM ${qualifiedTable} ${whereClause}`)
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
		const whereClause = where
			? `WHERE ${buildWhereClause(where).clause}`
			: "";
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
		const whereClause = where
			? `WHERE ${buildWhereClause(where).clause}`
			: "";
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
		const whereClause = where
			? `WHERE ${buildWhereClause(where).clause}`
			: "";
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
		const whereClause = where
			? `WHERE ${buildWhereClause(where).clause}`
			: "";
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
	 */
	async flush(): Promise<number> {
		if (this.ops.length === 0) return 0;

		const opsToFlush = [...this.ops];
		this.ops.length = 0;

		const statements = this.buildStatements(opsToFlush);

		// If db is already a transaction, execute directly
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

		return opsToFlush.length;
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
		delete data._upsert_keys;
		delete data._upsert_fallback_keys;
		delete data._upsert_fallback_set;

		data._block_height = this.block.height;
		data._tx_id = this._tx.txId;
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

	/** Build SQL statements from write ops, batching compatible INSERTs. */
	private buildStatements(ops: WriteOp[]): string[] {
		const statements: string[] = [];

		// Group consecutive inserts by batch key
		type InsertBatch = {
			table: string;
			cols: string[];
			rows: string[][];
			upsertKeys: string[] | undefined;
		};

		let currentBatch: InsertBatch | null = null;
		let currentBatchKey = "";

		const flushInsertBatch = () => {
			if (!currentBatch) return;
			const qualifiedTable = `"${this.pgSchemaName}"."${currentBatch.table}"`;
			const colList = currentBatch.cols.map((c) => `"${c}"`).join(", ");

			// Deduplicate by upsert key — last row wins (Postgres rejects duplicate keys in one INSERT)
			let rows = currentBatch.rows;
			if (currentBatch.upsertKeys && currentBatch.upsertKeys.length > 0) {
				const keyIndices = currentBatch.upsertKeys.map((k) =>
					currentBatch!.cols.indexOf(k),
				);
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

			if (currentBatch.upsertKeys && currentBatch.upsertKeys.length > 0) {
				const updateCols = currentBatch.cols.filter(
					(c) => !currentBatch!.upsertKeys!.includes(c) && !c.startsWith("_"),
				);
				if (updateCols.length > 0) {
					const setClauses = updateCols.map((c) => `"${c}" = EXCLUDED."${c}"`);
					stmt += ` ON CONFLICT (${currentBatch.upsertKeys.map((k) => `"${k}"`).join(", ")}) DO UPDATE SET ${setClauses.join(", ")}`;
				} else {
					stmt += ` ON CONFLICT (${currentBatch.upsertKeys.map((k) => `"${k}"`).join(", ")}) DO NOTHING`;
				}
			}

			statements.push(stmt);
			currentBatch = null;
			currentBatchKey = "";
		};

		for (const op of ops) {
			const qualifiedTable = `"${this.pgSchemaName}"."${op.table}"`;

			if (op.kind === "insert") {
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
			} else {
				// Non-insert — flush any pending insert batch first
				flushInsertBatch();

				if (op.kind === "update") {
					const setEntries = Object.entries(op.set!);
					setEntries.forEach(([k]) => validateColumnName(k));
					const setClauses = setEntries.map(
						([k, v]) => `"${k}" = ${escapeLiteral(v)}`,
					);
					const { clause } = buildWhereClause(op.data);
					statements.push(
						`UPDATE ${qualifiedTable} SET ${setClauses.join(", ")} WHERE ${clause}`,
					);
				} else if (op.kind === "delete") {
					const { clause } = buildWhereClause(op.data);
					statements.push(`DELETE FROM ${qualifiedTable} WHERE ${clause}`);
				}
			}
		}

		// Flush any remaining insert batch
		flushInsertBatch();

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

function escapeLiteral(value: unknown): string {
	if (value === null || value === undefined) return "NULL";
	if (typeof value === "number" || typeof value === "bigint")
		return String(value);
	if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
	if (typeof value === "object")
		return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
	// String — escape single quotes
	return `'${String(value).replace(/'/g, "''")}'`;
}

function buildWhereClause(where: Record<string, unknown>): {
	clause: string;
	values: unknown[];
} {
	const entries = Object.entries(where);
	if (entries.length === 0) return { clause: "TRUE", values: [] };

	entries.forEach(([k]) => validateColumnName(k));
	const parts = entries.map(([k, v]) => `"${k}" = ${escapeLiteral(v)}`);
	return { clause: parts.join(" AND "), values: [] };
}
