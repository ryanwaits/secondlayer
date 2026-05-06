import { ParquetSchema } from "@dsnp/parquetjs";

export const STX_TRANSFERS_DATASET = "stx-transfers";
export const STX_TRANSFERS_VERSION = "v0";
export const STX_TRANSFERS_SCHEMA_VERSION = 0;

export type StxTransfersSchemaColumn = {
	name: string;
	type: "string" | "int32" | "int64";
	nullable: boolean;
	description: string;
};

export const STX_TRANSFERS_SCHEMA_COLUMNS = [
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
		name: "sender",
		type: "string",
		nullable: false,
		description: "STX sender address.",
	},
	{
		name: "recipient",
		type: "string",
		nullable: false,
		description: "STX recipient address.",
	},
	{
		name: "amount",
		type: "string",
		nullable: false,
		description: "Amount in microSTX as decimal string (preserves u128 precision).",
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
		description: "Zero-padded inclusive block range covered by the parquet file.",
	},
] as const satisfies readonly StxTransfersSchemaColumn[];

export type StxTransfersSchemaDocument = {
	dataset: typeof STX_TRANSFERS_DATASET;
	version: typeof STX_TRANSFERS_VERSION;
	schema_version: typeof STX_TRANSFERS_SCHEMA_VERSION;
	network: string;
	columns: typeof STX_TRANSFERS_SCHEMA_COLUMNS;
};

const STRING_FIELD = { type: "UTF8", compression: "SNAPPY" } as const;
const INT32_FIELD = { type: "INT32", compression: "SNAPPY" } as const;
const INT64_FIELD = { type: "INT64", compression: "SNAPPY" } as const;

export function createStxTransfersParquetSchema(): ParquetSchema {
	return new ParquetSchema({
		cursor: STRING_FIELD,
		block_height: INT64_FIELD,
		block_time: STRING_FIELD,
		tx_id: STRING_FIELD,
		tx_index: INT32_FIELD,
		event_index: INT32_FIELD,
		sender: STRING_FIELD,
		recipient: STRING_FIELD,
		amount: STRING_FIELD,
		memo: { ...STRING_FIELD, optional: true },
		partition_block_range: STRING_FIELD,
	});
}

export function createStxTransfersSchemaDocument(
	network: string,
): StxTransfersSchemaDocument {
	return {
		dataset: STX_TRANSFERS_DATASET,
		version: STX_TRANSFERS_VERSION,
		schema_version: STX_TRANSFERS_SCHEMA_VERSION,
		network,
		columns: STX_TRANSFERS_SCHEMA_COLUMNS,
	};
}
