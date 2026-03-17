import type { ColumnType, SubgraphColumn, SubgraphTable } from "./types.ts";

// ── Column type mapping ──────────────────────────────────────────────────

/** Maps a ColumnType string literal to its TypeScript equivalent */
export type ColumnToTS<T extends string> = T extends "uint" | "int"
  ? number
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
  _blockHeight: number;
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
  blockHeight?: number | ComparisonFilter<number>;
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

export interface FindManyOptions<TRow> {
  where?: WhereInput<TRow> & SystemWhereAliases;
  orderBy?: { [K in keyof TRow]?: "asc" | "desc" } & SystemOrderByAliases;
  limit?: number;
  offset?: number;
  fields?: (keyof TRow & string)[];
}

export interface SubgraphTableClient<TRow> {
  findMany(options?: FindManyOptions<TRow>): Promise<TRow[]>;
  count(where?: WhereInput<TRow> & SystemWhereAliases): Promise<number>;
}

// ── Full subgraph client inference ────────────────────────────────────────

/** Infer a typed client object from a subgraph definition shape */
export type InferSubgraphClient<T> = T extends { schema: infer S }
  ? {
      [K in keyof S]: S[K] extends SubgraphTable ? SubgraphTableClient<InferTableRow<S[K]>> : never;
    }
  : never;
