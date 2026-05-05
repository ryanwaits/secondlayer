import { ParquetSchema } from "@dsnp/parquetjs";

export const STREAMS_BULK_DATASET = "stacks-streams";
export const STREAMS_BULK_VERSION = "v0";
export const STREAMS_BULK_SCHEMA_VERSION = 0;

export type StreamsBulkSchemaColumn = {
	name: string;
	type: "string" | "int32" | "int64";
	nullable: boolean;
	description: string;
};

export const STREAMS_BULK_SCHEMA_COLUMNS = [
	{
		name: "cursor",
		type: "string",
		nullable: false,
		description: "Stable Streams cursor in <block_height>:<event_index> form.",
	},
	{
		name: "block_height",
		type: "int64",
		nullable: false,
		description: "Canonical Stacks block height.",
	},
	{
		name: "index_block_hash",
		type: "string",
		nullable: false,
		description: "Canonical Stacks index block hash for block_height.",
	},
	{
		name: "burn_block_height",
		type: "int64",
		nullable: false,
		description: "Bitcoin burn block height associated with the Stacks block.",
	},
	{
		name: "burn_block_hash",
		type: "string",
		nullable: true,
		description: "Bitcoin burn block hash when available for this historical row.",
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
		description: "Normalized Stacks Streams event type.",
	},
	{
		name: "contract_id",
		type: "string",
		nullable: true,
		description: "Associated contract id for contract-scoped events.",
	},
	{
		name: "ts",
		type: "string",
		nullable: false,
		description: "Block timestamp as an ISO-8601 UTC string.",
	},
	{
		name: "payload_json",
		type: "string",
		nullable: false,
		description: "Deterministic JSON encoding of the public Streams payload.",
	},
	{
		name: "partition_block_range",
		type: "string",
		nullable: false,
		description: "Zero-padded inclusive block range covered by the parquet file.",
	},
] as const satisfies readonly StreamsBulkSchemaColumn[];

export type StreamsBulkSchemaDocument = {
	dataset: typeof STREAMS_BULK_DATASET;
	version: typeof STREAMS_BULK_VERSION;
	schema_version: typeof STREAMS_BULK_SCHEMA_VERSION;
	network: string;
	columns: typeof STREAMS_BULK_SCHEMA_COLUMNS;
};

const STRING_FIELD = { type: "UTF8", compression: "SNAPPY" } as const;
const INT32_FIELD = { type: "INT32", compression: "SNAPPY" } as const;
const INT64_FIELD = { type: "INT64", compression: "SNAPPY" } as const;

export function createStreamsBulkParquetSchema(): ParquetSchema {
	return new ParquetSchema({
		cursor: STRING_FIELD,
		block_height: INT64_FIELD,
		index_block_hash: STRING_FIELD,
		burn_block_height: INT64_FIELD,
		burn_block_hash: { ...STRING_FIELD, optional: true },
		tx_id: STRING_FIELD,
		tx_index: INT32_FIELD,
		event_index: INT32_FIELD,
		event_type: STRING_FIELD,
		contract_id: { ...STRING_FIELD, optional: true },
		ts: STRING_FIELD,
		payload_json: STRING_FIELD,
		partition_block_range: STRING_FIELD,
	});
}

export function createStreamsBulkSchemaDocument(
	network: string,
): StreamsBulkSchemaDocument {
	return {
		dataset: STREAMS_BULK_DATASET,
		version: STREAMS_BULK_VERSION,
		schema_version: STREAMS_BULK_SCHEMA_VERSION,
		network,
		columns: STREAMS_BULK_SCHEMA_COLUMNS,
	};
}
