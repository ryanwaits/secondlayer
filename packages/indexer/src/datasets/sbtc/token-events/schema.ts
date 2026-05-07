import { ParquetSchema } from "@dsnp/parquetjs";

export const SBTC_TOKEN_EVENTS_DATASET = "sbtc/token-events";
export const SBTC_TOKEN_EVENTS_VERSION = "v0";
export const SBTC_TOKEN_EVENTS_SCHEMA_VERSION = 0;

export type SbtcTokenEventsSchemaColumn = {
	name: string;
	type: "string" | "int32" | "int64";
	nullable: boolean;
	description: string;
};

export const SBTC_TOKEN_EVENTS_SCHEMA_COLUMNS = [
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
		description: "0-indexed parent transaction position within the block.",
	},
	{
		name: "event_index",
		type: "int32",
		nullable: false,
		description: "Streams event index within the block.",
	},
	{
		name: "event_type",
		type: "string",
		nullable: false,
		description: "SIP-010 event variant: transfer | mint | burn.",
	},
	{
		name: "sender",
		type: "string",
		nullable: true,
		description: "sBTC sender. Null for mint.",
	},
	{
		name: "recipient",
		type: "string",
		nullable: true,
		description: "sBTC recipient. Null for burn.",
	},
	{
		name: "amount",
		type: "string",
		nullable: false,
		description: "Amount in sats as decimal string (preserves u128 precision).",
	},
	{
		name: "memo",
		type: "string",
		nullable: true,
		description: "Hex-encoded memo if present.",
	},
	{
		name: "partition_block_range",
		type: "string",
		nullable: false,
		description:
			"Zero-padded inclusive block range covered by the parquet file.",
	},
] as const satisfies readonly SbtcTokenEventsSchemaColumn[];

export type SbtcTokenEventsSchemaDocument = {
	dataset: typeof SBTC_TOKEN_EVENTS_DATASET;
	version: typeof SBTC_TOKEN_EVENTS_VERSION;
	schema_version: typeof SBTC_TOKEN_EVENTS_SCHEMA_VERSION;
	network: string;
	columns: typeof SBTC_TOKEN_EVENTS_SCHEMA_COLUMNS;
};

const STRING_FIELD = { type: "UTF8", compression: "SNAPPY" } as const;
const INT32_FIELD = { type: "INT32", compression: "SNAPPY" } as const;
const INT64_FIELD = { type: "INT64", compression: "SNAPPY" } as const;

export function createSbtcTokenEventsParquetSchema(): ParquetSchema {
	return new ParquetSchema({
		cursor: STRING_FIELD,
		block_height: INT64_FIELD,
		block_time: STRING_FIELD,
		tx_id: STRING_FIELD,
		tx_index: INT32_FIELD,
		event_index: INT32_FIELD,
		event_type: STRING_FIELD,
		sender: { ...STRING_FIELD, optional: true },
		recipient: { ...STRING_FIELD, optional: true },
		amount: STRING_FIELD,
		memo: { ...STRING_FIELD, optional: true },
		partition_block_range: STRING_FIELD,
	});
}

export function createSbtcTokenEventsSchemaDocument(
	network: string,
): SbtcTokenEventsSchemaDocument {
	return {
		dataset: SBTC_TOKEN_EVENTS_DATASET,
		version: SBTC_TOKEN_EVENTS_VERSION,
		schema_version: SBTC_TOKEN_EVENTS_SCHEMA_VERSION,
		network,
		columns: SBTC_TOKEN_EVENTS_SCHEMA_COLUMNS,
	};
}
