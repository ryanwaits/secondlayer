import type { AbiContract } from "@secondlayer/stacks/clarity";

/** Supported column types for subgraph schemas */
export type ColumnType =
	| "text"
	| "uint"
	| "int"
	| "principal"
	| "boolean"
	| "timestamp"
	| "jsonb";

/** Column definition in a subgraph table */
export interface SubgraphColumn {
	type: ColumnType;
	nullable?: boolean;
	indexed?: boolean;
	search?: boolean;
	default?: string | number | boolean;
}

/** Table definition within a subgraph schema */
export interface SubgraphTable {
	columns: Record<string, SubgraphColumn>;
	/** Composite indexes (each entry is an array of column names) */
	indexes?: string[][];
	/** Unique key constraints (each entry is an array of column names). Required for upsert. */
	uniqueKeys?: string[][];
}

/** Subgraph schema — maps table names to table definitions */
export type SubgraphSchema = Record<string, SubgraphTable>;

// ── SubgraphFilter ──────────────────────────────────────────────────
// Discriminated union of event filter types.
// Sources are named objects: { sourceName: SubgraphFilter }

/** STX event filters */
export interface StxTransferFilter {
	type: "stx_transfer";
	sender?: string;
	recipient?: string;
	minAmount?: bigint;
	maxAmount?: bigint;
}
export interface StxMintFilter {
	type: "stx_mint";
	recipient?: string;
	minAmount?: bigint;
}
export interface StxBurnFilter {
	type: "stx_burn";
	sender?: string;
	minAmount?: bigint;
}
export interface StxLockFilter {
	type: "stx_lock";
	lockedAddress?: string;
	minAmount?: bigint;
}

/** FT event filters */
export interface FtTransferFilter {
	type: "ft_transfer";
	assetIdentifier?: string;
	sender?: string;
	recipient?: string;
	minAmount?: bigint;
}
export interface FtMintFilter {
	type: "ft_mint";
	assetIdentifier?: string;
	recipient?: string;
	minAmount?: bigint;
}
export interface FtBurnFilter {
	type: "ft_burn";
	assetIdentifier?: string;
	sender?: string;
	minAmount?: bigint;
}

/** NFT event filters */
export interface NftTransferFilter {
	type: "nft_transfer";
	assetIdentifier?: string;
	sender?: string;
	recipient?: string;
}
export interface NftMintFilter {
	type: "nft_mint";
	assetIdentifier?: string;
	recipient?: string;
}
export interface NftBurnFilter {
	type: "nft_burn";
	assetIdentifier?: string;
	sender?: string;
}

/**
 * Event shape passed to contract_call handlers.
 *
 * `args` is a **positional array** of decoded Clarity values matching the
 * contract function's parameter list in declaration order. Use the ABI
 * (or Clarity contract source) to map positions to names:
 *
 * ```ts
 * // pox-4 stack-stx args: (amount-ustx uint) (pox-addr tuple) (start-burn-ht uint) (lock-period uint)
 * const [amountUstx, , , lockPeriod] = event.args;
 * ```
 *
 * Bigints come out as `bigint`. Buffers as `Uint8Array`. Principals as
 * strings (`"SP..."`). Tuples as `Record<string, unknown>`.
 *
 * Historical transactions indexed before the function_args column was added
 * will have `args = []` — always guard with `args.length > 0` when reading
 * args from pre-Nakamoto history.
 */
export interface ContractCallEvent {
	type: "contract_call";
	/** Transaction sender (the principal who signed the tx). Always non-null. */
	sender: string;
	contractId: string;
	functionName: string;
	/** Positional decoded Clarity values — order matches the ABI parameter list. */
	args: unknown[];
	/** Decoded return value from the contract function, or null. */
	result: unknown;
	/** Raw hex-encoded result value. */
	resultHex: string | null;
	/** Transaction metadata. */
	tx: {
		txId: string;
		sender: string;
		type: string;
		status: string;
		contractId: string | null;
		functionName: string | null;
	};
}

/** Contract event filters */
export interface ContractCallFilter {
	type: "contract_call";
	contractId?: string;
	functionName?: string;
	caller?: string;
	/**
	 * Contract ABI (pass it `as const`) used to type `event.input` — the named,
	 * decoded function arguments. Dev-provided; serialized into the deployed
	 * definition and used at runtime to decode args by name. Omit to keep
	 * `event.args` as a positional `unknown[]`.
	 */
	abi?: AbiContract;
}
export interface ContractDeployFilter {
	type: "contract_deploy";
	deployer?: string;
	contractName?: string;
}
export interface PrintEventFilter {
	type: "print_event";
	contractId?: string;
	topic?: string;
	/**
	 * Optional per-topic field schema. When declared, the handler's `event` is
	 * a discriminated union keyed by `topic` and `event.data` is typed per topic
	 * (e.g. `{ "completed-deposit": { amount: "uint", sender: "principal" } }`).
	 * Uses the same `ColumnType` vocab as `schema`; nested fields use `"jsonb"`.
	 * Type-level only — not validated at runtime.
	 */
	prints?: Record<string, Record<string, ColumnType>>;
}

/** All subgraph filter types — discriminated on `type` */
export type SubgraphFilter =
	| StxTransferFilter
	| StxMintFilter
	| StxBurnFilter
	| StxLockFilter
	| FtTransferFilter
	| FtMintFilter
	| FtBurnFilter
	| NftTransferFilter
	| NftMintFilter
	| NftBurnFilter
	| ContractCallFilter
	| ContractDeployFilter
	| PrintEventFilter;

/** Transaction metadata available in handlers */
export interface TxMeta {
	txId: string;
	sender: string;
	type: string;
	status: string;
	contractId?: string | null;
	functionName?: string | null;
}

/** Scalar types that can appear as row values */
export type RowValue =
	| string
	| number
	| bigint
	| boolean
	| null
	| undefined
	| Record<string, unknown>
	| unknown[];

/** Value or computed function that receives existing row */
export type ComputedValue =
	| RowValue
	| ((existing: Record<string, unknown> | null) => unknown);

/** Context passed to subgraph handlers during event processing */
export interface SubgraphContext {
	block: {
		height: number;
		hash: string;
		timestamp: number;
		burnBlockHeight: number;
	};
	tx: TxMeta;
	insert(table: string, row: Record<string, unknown>): void;
	update(
		table: string,
		where: Record<string, unknown>,
		set: Record<string, unknown>,
	): void;
	upsert(
		table: string,
		key: Record<string, unknown>,
		row: Record<string, unknown>,
	): void;
	delete(table: string, where: Record<string, unknown>): void;
	/** Partial update — sets only specified fields, preserves others */
	patch(
		table: string,
		where: Record<string, unknown>,
		set: Record<string, unknown>,
	): void;
	/** Find-then-merge-or-insert. Values can be functions: (existing) => newValue */
	patchOrInsert(
		table: string,
		key: Record<string, unknown>,
		row: Record<string, ComputedValue>,
	): Promise<void>;
	findOne(
		table: string,
		where: Record<string, unknown>,
	): Promise<Record<string, unknown> | null>;
	findMany(
		table: string,
		where: Record<string, unknown>,
	): Promise<Record<string, unknown>[]>;
	/** Format a bigint amount with decimal places */
	formatUnits(value: bigint, decimals: number): string;
	/** Count rows matching filter */
	count(table: string, where?: Record<string, unknown>): Promise<number>;
	/** Sum a numeric column */
	sum(
		table: string,
		column: string,
		where?: Record<string, unknown>,
	): Promise<bigint>;
	/** Min of a numeric column */
	min(
		table: string,
		column: string,
		where?: Record<string, unknown>,
	): Promise<bigint | null>;
	/** Max of a numeric column */
	max(
		table: string,
		column: string,
		where?: Record<string, unknown>,
	): Promise<bigint | null>;
	/** Count distinct values in a column */
	countDistinct(
		table: string,
		column: string,
		where?: Record<string, unknown>,
	): Promise<number>;
}

/** Handler function that processes events and writes to the subgraph */
export type SubgraphHandler = (
	event: Record<string, unknown>,
	ctx: SubgraphContext,
) => Promise<void> | void;

/** Complete subgraph definition */
export interface SubgraphDefinition {
	/** Unique subgraph name (lowercase, alphanumeric + hyphens) */
	name: string;
	/** Semantic version */
	version?: string;
	/** Human description */
	description?: string;
	/** Block height to start indexing from (default: 1) */
	startBlock?: number;
	/** Named source filters — keys become handler keys */
	sources: Record<string, SubgraphFilter>;
	/** Tables in this subgraph */
	schema: SubgraphSchema;
	/** Handler functions — keys must match source names (or "*" for catch-all) */
	handlers: Record<string, SubgraphHandler>;
}
