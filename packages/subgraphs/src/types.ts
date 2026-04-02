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
// Discriminated union aligned with StreamFilter vocabulary.
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

/** Contract event filters */
export interface ContractCallFilter {
	type: "contract_call";
	contractId?: string;
	functionName?: string;
	caller?: string;
	/** ABI for typed event.args. If omitted, auto-fetched at deploy time. */
	abi?: Record<string, unknown>;
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

/** Value or computed function that receives existing row */
export type ComputedValue<T = unknown> = T | ((existing: Record<string, unknown> | null) => T);

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
