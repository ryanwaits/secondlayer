import type { DatasetParquetColumn } from "../../_shared/parquet.ts";

export const BNS_MARKETPLACE_EVENTS_DATASET = "bns/marketplace-events";
export const BNS_MARKETPLACE_EVENTS_VERSION = "v0";
export const BNS_MARKETPLACE_EVENTS_SCHEMA_VERSION = 0;

export const BNS_MARKETPLACE_EVENTS_SCHEMA_COLUMNS = [
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
		name: "action",
		type: "string",
		nullable: false,
		description:
			"BNS-V2 marketplace action (list, unlist, sale, price-change, etc.).",
	},
	{
		name: "bns_id",
		type: "string",
		nullable: false,
		description: "Internal BNS id of the listed name.",
	},
	{
		name: "price_ustx",
		type: "string",
		nullable: true,
		description: "Listing or sale price in microSTX (decimal string).",
	},
	{
		name: "commission",
		type: "string",
		nullable: true,
		description: "Commission paid to marketplace contract (decimal string).",
	},
	{
		name: "partition_block_range",
		type: "string",
		nullable: false,
		description: "Zero-padded inclusive block range covered by the parquet file.",
	},
] as const satisfies readonly DatasetParquetColumn[];
