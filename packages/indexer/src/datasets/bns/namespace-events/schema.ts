import type { DatasetParquetColumn } from "../../_shared/parquet.ts";

export const BNS_NAMESPACE_EVENTS_DATASET = "bns/namespace-events";
export const BNS_NAMESPACE_EVENTS_VERSION = "v0";
export const BNS_NAMESPACE_EVENTS_SCHEMA_VERSION = 0;

export const BNS_NAMESPACE_EVENTS_SCHEMA_COLUMNS = [
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
		name: "status",
		type: "string",
		nullable: false,
		description:
			"BNS-V2 namespace event status (preorder, reveal, ready, manager-update, etc.).",
	},
	{
		name: "namespace",
		type: "string",
		nullable: false,
		description: "Namespace label this event applies to.",
	},
	{
		name: "manager",
		type: "string",
		nullable: true,
		description: "Manager principal for managed namespaces.",
	},
	{
		name: "manager_frozen",
		type: "boolean",
		nullable: true,
		description: "Whether the namespace manager is frozen (no further updates).",
	},
	{
		name: "manager_transfers_disabled",
		type: "boolean",
		nullable: true,
		description: "Whether transfers within the namespace are disabled.",
	},
	{
		name: "price_function",
		type: "string",
		nullable: true,
		description: "Hex-encoded price-function tuple supplied at reveal.",
	},
	{
		name: "price_frozen",
		type: "boolean",
		nullable: true,
		description: "Whether the namespace pricing curve is frozen.",
	},
	{
		name: "lifetime",
		type: "int64",
		nullable: true,
		description: "Default registration lifetime in blocks.",
	},
	{
		name: "revealed_at",
		type: "int64",
		nullable: true,
		description: "Block height at which the namespace was revealed.",
	},
	{
		name: "launched_at",
		type: "int64",
		nullable: true,
		description: "Block height at which the namespace was marked ready (live).",
	},
	{
		name: "partition_block_range",
		type: "string",
		nullable: false,
		description: "Zero-padded inclusive block range covered by the parquet file.",
	},
] as const satisfies readonly DatasetParquetColumn[];
