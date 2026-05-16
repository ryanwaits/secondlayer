import type { DatasetParquetColumn } from "../../_shared/parquet.ts";

export const BNS_NAME_EVENTS_DATASET = "bns/name-events";
export const BNS_NAME_EVENTS_VERSION = "v0";
export const BNS_NAME_EVENTS_SCHEMA_VERSION = 0;

export const BNS_NAME_EVENTS_SCHEMA_COLUMNS = [
	{
		name: "cursor",
		type: "string",
		nullable: false,
		description: "Streams cursor in <block_height>:<event_index> form.",
	},
	{
		name: "block_height",
		type: "int64",
		nullable: false,
		description: "Canonical Stacks block height.",
	},
	{
		name: "block_time",
		type: "string",
		nullable: false,
		description: "ISO-8601 UTC block timestamp.",
	},
	{
		name: "tx_id",
		type: "string",
		nullable: false,
		description: "Parent transaction id.",
	},
	{
		name: "tx_index",
		type: "int32",
		nullable: false,
		description: "0-indexed parent transaction position in block.",
	},
	{
		name: "event_index",
		type: "int32",
		nullable: false,
		description: "Streams event index within the block.",
	},
	{
		name: "topic",
		type: "string",
		nullable: false,
		description:
			"BNS-V2 name event topic (register, transfer, renew, burn, airdrop, etc.).",
	},
	{
		name: "namespace",
		type: "string",
		nullable: false,
		description: "Namespace label (e.g. 'btc').",
	},
	{
		name: "name",
		type: "string",
		nullable: false,
		description: "Name label without the namespace suffix.",
	},
	{
		name: "fqn",
		type: "string",
		nullable: false,
		description: "Fully-qualified name (name.namespace).",
	},
	{
		name: "owner",
		type: "string",
		nullable: true,
		description: "Owner principal after the event; null on burn.",
	},
	{
		name: "bns_id",
		type: "string",
		nullable: false,
		description: "Internal BNS id (`namespace/name`) used by the contract.",
	},
	{
		name: "registered_at",
		type: "int64",
		nullable: true,
		description: "Stacks block height the name was first registered.",
	},
	{
		name: "imported_at",
		type: "int64",
		nullable: true,
		description: "Stacks block height the name was imported, if applicable.",
	},
	{
		name: "renewal_height",
		type: "int64",
		nullable: true,
		description: "Block height at which the current registration expires.",
	},
	{
		name: "stx_burn",
		type: "string",
		nullable: true,
		description: "Amount of STX burned by the action (decimal string).",
	},
	{
		name: "preordered_by",
		type: "string",
		nullable: true,
		description: "Principal that placed the preorder, if discoverable.",
	},
	{
		name: "hashed_salted_fqn_preorder",
		type: "string",
		nullable: true,
		description: "Hex-encoded preorder commitment hash.",
	},
	{
		name: "partition_block_range",
		type: "string",
		nullable: false,
		description: "Zero-padded inclusive block range covered by the parquet file.",
	},
] as const satisfies readonly DatasetParquetColumn[];
