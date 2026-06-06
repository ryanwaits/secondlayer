import type {
	ColumnType,
	ComputedValue,
	SubgraphColumn,
	SubgraphSchema,
	SubgraphTable,
	TxMeta,
} from "./types.ts";

// ── Column type mapping ──────────────────────────────────────────────────

/** Maps a ColumnType string literal to its TypeScript equivalent */
export type ColumnToTS<T extends string> = T extends "uint" | "int"
	? bigint
	: T extends "text" | "principal" | "timestamp"
		? string
		: T extends "boolean"
			? boolean
			: T extends "jsonb"
				? Record<string, unknown>
				: unknown;

/** Infer TS type for a single column definition, respecting nullable */
export type InferColumnType<C extends SubgraphColumn> =
	C["type"] extends ColumnType
		? C["nullable"] extends true
			? ColumnToTS<C["type"]> | null
			: ColumnToTS<C["type"]>
		: unknown;

// ── System columns added to every row ───────────────────────────────────

/** Shape of system columns on every returned row (camelCase, underscore-prefixed) */
export interface SystemRow {
	_id: string;
	_blockHeight: bigint;
	_txId: string;
	_createdAt: string;
}

// ── Table row inference ──────────────────────────────────────────────────

/** Infer the row shape for a single table definition */
export type InferTableRow<T extends SubgraphTable> = SystemRow & {
	[K in keyof T["columns"]]: InferColumnType<T["columns"][K]>;
};

// ── Query input types ────────────────────────────────────────────────────

/** Comparison operators for a scalar value */
export type ComparisonFilter<T> = {
	eq?: T;
	neq?: T;
	gt?: T;
	gte?: T;
	lt?: T;
	lte?: T;
	/** Match any value in the set. */
	in?: T[];
	/** Match none of the values in the set. */
	notIn?: T[];
	/** SQL ILIKE pattern (case-insensitive); `%`/`_` wildcards. Strings only. */
	like?: string;
};

/** Where clause — each column accepts a scalar (eq) or comparison object */
export type WhereInput<TRow> = {
	[K in keyof TRow]?: TRow[K] | ComparisonFilter<TRow[K]>;
};

/**
 * No-prefix aliases for system columns accepted in where/orderBy inputs.
 * Both `_blockHeight` and `blockHeight` are valid — serializer handles mapping.
 */
export type SystemWhereAliases = {
	blockHeight?: bigint | ComparisonFilter<bigint>;
	txId?: string | ComparisonFilter<string>;
	createdAt?: string | ComparisonFilter<string>;
	id?: string | ComparisonFilter<string>;
};

export type SystemOrderByAliases = {
	blockHeight?: "asc" | "desc";
	txId?: "asc" | "desc";
	createdAt?: "asc" | "desc";
	id?: "asc" | "desc";
};

// ── Per-table client ─────────────────────────────────────────────────────

/** Ordered list form for deterministic multi-column sort. */
export type OrderByList<TRow> = Array<
	[keyof (TRow & SystemOrderByAliases) & string, "asc" | "desc"]
>;

export interface FindManyOptions<TRow> {
	where?: WhereInput<TRow> & SystemWhereAliases;
	/**
	 * Single-key object (common case) OR an ordered `[column, direction][]` list
	 * for deterministic multi-column sort (object key order isn't guaranteed).
	 */
	orderBy?:
		| ({ [K in keyof TRow]?: "asc" | "desc" } & SystemOrderByAliases)
		| OrderByList<TRow>;
	limit?: number;
	offset?: number;
	fields?: (keyof TRow & string)[];
}

/** Options for the realtime row stream (SSE). */
export interface SubscribeOptions<TRow> {
	/** Same column filters as `findMany`, applied server-side per row. */
	where?: WhereInput<TRow> & SystemWhereAliases;
	/** Replay rows from this block height, then tail live. Omit for go-forward only. */
	since?: number;
	/** Called on stream/connection errors. */
	onError?: (err: unknown) => void;
}

// ── Aggregate spec + result inference ────────────────────────────────────

/**
 * Numeric column keys of a row — those whose (non-null) TS type is `bigint`
 * (uint/int columns, incl. nullable, plus the system `_blockHeight`). Only
 * these are valid SUM/MIN/MAX targets at compile time.
 */
type NumericKeys<TRow> = {
	[K in keyof TRow]-?: NonNullable<TRow[K]> extends bigint ? K : never;
}[keyof TRow] &
	string;

/** Any column key of a row (valid COUNT DISTINCT target). */
type AnyKey<TRow> = keyof TRow & string;

/** Aggregate request spec. SUM/MIN/MAX restricted to numeric columns. */
export interface AggregateSpec<TRow> {
	count?: boolean;
	countDistinct?: AnyKey<TRow>[];
	sum?: NumericKeys<TRow>[];
	min?: NumericKeys<TRow>[];
	max?: NumericKeys<TRow>[];
	where?: WhereInput<TRow> & SystemWhereAliases;
}

/** Narrows the literal column names listed under a spec key. */
type ColsOf<A, K extends keyof A> = A[K] extends readonly (infer C extends
	string)[]
	? C
	: never;

/**
 * Result shape inferred from an `AggregateSpec`. Each block is present only when
 * the corresponding spec key was provided. Counts are numbers; sum/min/max are
 * lossless strings (min/max nullable over an empty/all-null set).
 */
export type AggregateResult<
	TRow,
	A extends AggregateSpec<TRow>,
> = (A["count"] extends true ? { count: number } : unknown) &
	(A["countDistinct"] extends readonly string[]
		? { countDistinct: Record<ColsOf<A, "countDistinct">, number> }
		: unknown) &
	(A["sum"] extends readonly string[]
		? { sum: Record<ColsOf<A, "sum">, string> }
		: unknown) &
	(A["min"] extends readonly string[]
		? { min: Record<ColsOf<A, "min">, string | null> }
		: unknown) &
	(A["max"] extends readonly string[]
		? { max: Record<ColsOf<A, "max">, string | null> }
		: unknown);

export interface SubgraphTableClient<TRow> {
	findMany(options?: FindManyOptions<TRow>): Promise<TRow[]>;
	count(where?: WhereInput<TRow> & SystemWhereAliases): Promise<number>;
	/**
	 * Scalar aggregates over the filtered set. SUM/MIN/MAX accept numeric columns
	 * only (compile-time enforced). The result type is narrowed from the spec —
	 * no `as const` needed thanks to the `const` type parameter. SUM/MIN/MAX are
	 * lossless strings; counts are numbers.
	 */
	aggregate<const A extends AggregateSpec<TRow>>(
		spec: A,
	): Promise<AggregateResult<TRow, A>>;
	/**
	 * Stream rows as they're indexed over Server-Sent Events. `onRow` fires for
	 * each new row (block-cadence). Returns an unsubscribe function that closes
	 * the connection. Requires a global `EventSource` (browsers, Node >= 22).
	 */
	subscribe(
		onRow: (row: TRow) => void,
		options?: SubscribeOptions<TRow>,
	): () => void;
}

// ── Writable row + typed handler context ──────────────────────────────────

/** A column is optional on insert when it's nullable or has a SQL default. */
type IsOptionalColumn<C> = C extends { nullable: true }
	? true
	: C extends { default: string | number | boolean }
		? true
		: false;

/**
 * Row shape accepted by `ctx.insert`. System columns (`_id`, `_blockHeight`,
 * `_txId`, `_createdAt`) are omitted — the runtime adds them. Nullable and
 * defaulted columns are optional; all others required.
 */
export type WriteRow<T extends SubgraphTable> = {
	[K in keyof T["columns"] as IsOptionalColumn<T["columns"][K]> extends true
		? never
		: K]: InferColumnType<T["columns"][K]>;
} & {
	[K in keyof T["columns"] as IsOptionalColumn<T["columns"][K]> extends true
		? K
		: never]?: InferColumnType<T["columns"][K]>;
};

/** Computed-or-value row for `patchOrInsert` — each field may be a function of the existing row. */
type PatchRow<T extends SubgraphTable> = {
	[K in keyof WriteRow<T>]?:
		| WriteRow<T>[K]
		| ((existing: InferTableRow<T> | null) => unknown);
};

type TableName<S extends SubgraphSchema> = keyof S & string;
type ColumnName<
	S extends SubgraphSchema,
	T extends TableName<S>,
> = keyof S[T]["columns"] & string;
type RowWhere<S extends SubgraphSchema, T extends TableName<S>> = WhereInput<
	InferTableRow<S[T]>
>;

/**
 * Schema-typed handler context. Mirrors the runtime `SubgraphContext` but
 * checks table names against `S` and row/where shapes against each table's
 * columns. The runtime passes the concrete (untyped) context — this facade is
 * type-level only.
 */
export interface TypedSubgraphContext<S extends SubgraphSchema> {
	block: {
		height: number;
		hash: string;
		timestamp: number;
		burnBlockHeight: number;
	};
	tx: TxMeta;
	insert<T extends TableName<S>>(table: T, row: WriteRow<S[T]>): void;
	update<T extends TableName<S>>(
		table: T,
		where: RowWhere<S, T>,
		set: Partial<WriteRow<S[T]>>,
	): void;
	upsert<T extends TableName<S>>(
		table: T,
		key: Partial<WriteRow<S[T]>>,
		row: WriteRow<S[T]>,
	): void;
	delete<T extends TableName<S>>(table: T, where: RowWhere<S, T>): void;
	patch<T extends TableName<S>>(
		table: T,
		where: RowWhere<S, T>,
		set: Partial<WriteRow<S[T]>>,
	): void;
	patchOrInsert<T extends TableName<S>>(
		table: T,
		key: Partial<WriteRow<S[T]>>,
		row: PatchRow<S[T]> & Record<string, ComputedValue>,
	): Promise<void>;
	findOne<T extends TableName<S>>(
		table: T,
		where: RowWhere<S, T>,
	): Promise<InferTableRow<S[T]> | null>;
	findMany<T extends TableName<S>>(
		table: T,
		where: RowWhere<S, T>,
	): Promise<InferTableRow<S[T]>[]>;
	formatUnits(value: bigint, decimals: number): string;
	count<T extends TableName<S>>(
		table: T,
		where?: RowWhere<S, T>,
	): Promise<number>;
	sum<T extends TableName<S>>(
		table: T,
		column: ColumnName<S, T>,
		where?: RowWhere<S, T>,
	): Promise<bigint>;
	min<T extends TableName<S>>(
		table: T,
		column: ColumnName<S, T>,
		where?: RowWhere<S, T>,
	): Promise<bigint | null>;
	max<T extends TableName<S>>(
		table: T,
		column: ColumnName<S, T>,
		where?: RowWhere<S, T>,
	): Promise<bigint | null>;
	countDistinct<T extends TableName<S>>(
		table: T,
		column: ColumnName<S, T>,
		where?: RowWhere<S, T>,
	): Promise<number>;
}

// ── Full subgraph client inference ────────────────────────────────────────

/** Infer a typed client object from a subgraph definition shape */
export type InferSubgraphClient<T> = T extends { schema: infer S }
	? {
			[K in keyof S]: S[K] extends SubgraphTable
				? SubgraphTableClient<InferTableRow<S[K]>>
				: never;
		}
	: never;
