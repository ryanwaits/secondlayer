/** Supported column types for view schemas */
export type ColumnType =
  | "text"
  | "uint"
  | "int"
  | "principal"
  | "boolean"
  | "timestamp"
  | "jsonb";

/** Column definition in a view table */
export interface ViewColumn {
  type: ColumnType;
  nullable?: boolean;
  indexed?: boolean;
  default?: string | number | boolean;
}

/** Table definition within a view schema */
export interface ViewTable {
  columns: Record<string, ViewColumn>;
  /** Composite indexes (each entry is an array of column names) */
  indexes?: string[][];
  /** Unique key constraints (each entry is an array of column names). Required for upsert. */
  uniqueKeys?: string[][];
}

/** View schema — maps table names to table definitions */
export type ViewSchema = Record<string, ViewTable>;

/** Source filter for what blockchain data this view processes */
export interface ViewSource {
  /** Contract principal (e.g., SP000...::contract-name). Supports * wildcards. */
  contract?: string;
  /** Event name/topic to filter on */
  event?: string;
  /** Function name to filter on */
  function?: string;
  /** Transaction type filter (e.g., "stx_transfer", "contract_call") */
  type?: string;
  /** Minimum amount filter (for stx_transfer sources) */
  minAmount?: bigint;
}

/** Context passed to view handlers during event processing */
export interface ViewContext {
  block: { height: number; hash: string; timestamp: number; burnBlockHeight: number };
  tx: { txId: string; sender: string; type: string; status: string };
  insert(table: string, row: Record<string, unknown>): void;
  update(table: string, where: Record<string, unknown>, set: Record<string, unknown>): void;
  upsert(table: string, key: Record<string, unknown>, row: Record<string, unknown>): void;
  delete(table: string, where: Record<string, unknown>): void;
  findOne(table: string, where: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  findMany(table: string, where: Record<string, unknown>): Promise<Record<string, unknown>[]>;
}

/** Handler function that processes events and writes to the view */
export type ViewHandler = (
  event: Record<string, unknown>,
  ctx: ViewContext,
) => Promise<void> | void;

/**
 * Derive the source key used to look up handlers.
 * - { contract: "SP123.market", function: "list" } → "SP123.market::list"
 * - { contract: "SP123.market", event: "sale" } → "SP123.market::sale"
 * - { contract: "SP123.market" } → "SP123.market"
 * - { type: "stx_transfer" } → "stx_transfer"
 */
export function sourceKey(source: ViewSource): string {
  if (source.contract) {
    if (source.function) return `${source.contract}::${source.function}`;
    if (source.event) return `${source.contract}::${source.event}`;
    return source.contract;
  }
  if (source.type) return source.type;
  return "*";
}

/** Complete view definition */
export interface ViewDefinition {
  /** Unique view name (lowercase, alphanumeric + hyphens) */
  name: string;
  /** Semantic version */
  version?: string;
  /** Human description */
  description?: string;
  /** What blockchain data to process — one or more source filters */
  sources: ViewSource[];
  /** Tables in this view */
  schema: ViewSchema;
  /** Keyed handler functions — keys match sourceKey() output, "*" is catch-all */
  handlers: Record<string, ViewHandler>;
}
