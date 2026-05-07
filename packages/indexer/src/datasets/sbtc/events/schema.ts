import { ParquetSchema } from "@dsnp/parquetjs";

export const SBTC_EVENTS_DATASET = "sbtc/events";
export const SBTC_EVENTS_VERSION = "v0";
export const SBTC_EVENTS_SCHEMA_VERSION = 0;

export type SbtcEventsSchemaColumn = {
	name: string;
	type: "string" | "int32" | "int64";
	nullable: boolean;
	description: string;
};

export const SBTC_EVENTS_SCHEMA_COLUMNS = [
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
		name: "topic",
		type: "string",
		nullable: false,
		description:
			"sbtc-registry print topic (completed-deposit, withdrawal-*, key-rotation, update-protocol-contract).",
	},
	{
		name: "request_id",
		type: "int64",
		nullable: true,
		description: "Withdrawal request id; populated for withdrawal-* topics.",
	},
	{
		name: "amount",
		type: "string",
		nullable: true,
		description: "Amount in sats as decimal string (preserves u128 precision).",
	},
	{
		name: "sender",
		type: "string",
		nullable: true,
		description: "Stacks principal that initiated the action, when applicable.",
	},
	{
		name: "recipient_btc_version",
		type: "int32",
		nullable: true,
		description: "Bitcoin address version byte for the BTC recipient.",
	},
	{
		name: "recipient_btc_hashbytes",
		type: "string",
		nullable: true,
		description: "Hex-encoded Bitcoin address hashbytes for the BTC recipient.",
	},
	{
		name: "bitcoin_txid",
		type: "string",
		nullable: true,
		description:
			"Bitcoin txid associated with this event (deposit funding tx, withdrawal sweep, etc.).",
	},
	{
		name: "output_index",
		type: "int32",
		nullable: true,
		description: "Bitcoin output index for the funding/sweep tx.",
	},
	{
		name: "sweep_txid",
		type: "string",
		nullable: true,
		description: "Bitcoin sweep txid for withdrawal-accept events.",
	},
	{
		name: "burn_hash",
		type: "string",
		nullable: true,
		description: "Bitcoin burn block hash at request time.",
	},
	{
		name: "burn_height",
		type: "int64",
		nullable: true,
		description: "Bitcoin burn block height at request time.",
	},
	{
		name: "signer_bitmap",
		type: "string",
		nullable: true,
		description: "Hex-encoded signer set bitmap for the action.",
	},
	{
		name: "max_fee",
		type: "string",
		nullable: true,
		description: "Maximum fee accepted by the user (decimal string).",
	},
	{
		name: "fee",
		type: "string",
		nullable: true,
		description: "Actual fee charged (decimal string).",
	},
	{
		name: "block_height_at_request",
		type: "int64",
		nullable: true,
		description: "Stacks block height when withdrawal was requested.",
	},
	{
		name: "governance_contract_type",
		type: "int32",
		nullable: true,
		description:
			"update-protocol-contract: which protocol contract slot was updated.",
	},
	{
		name: "governance_new_contract",
		type: "string",
		nullable: true,
		description: "update-protocol-contract: principal of the new contract.",
	},
	{
		name: "signer_aggregate_pubkey",
		type: "string",
		nullable: true,
		description: "Hex-encoded aggregate signer pubkey on key-rotation.",
	},
	{
		name: "signer_threshold",
		type: "int32",
		nullable: true,
		description: "Signer threshold on key-rotation.",
	},
	{
		name: "signer_address",
		type: "string",
		nullable: true,
		description: "Address that triggered the key-rotation.",
	},
	{
		name: "signer_keys_count",
		type: "int32",
		nullable: true,
		description: "Number of signer keys in the new set.",
	},
	{
		name: "partition_block_range",
		type: "string",
		nullable: false,
		description:
			"Zero-padded inclusive block range covered by the parquet file.",
	},
] as const satisfies readonly SbtcEventsSchemaColumn[];

export type SbtcEventsSchemaDocument = {
	dataset: typeof SBTC_EVENTS_DATASET;
	version: typeof SBTC_EVENTS_VERSION;
	schema_version: typeof SBTC_EVENTS_SCHEMA_VERSION;
	network: string;
	columns: typeof SBTC_EVENTS_SCHEMA_COLUMNS;
};

const STRING_FIELD = { type: "UTF8", compression: "SNAPPY" } as const;
const INT32_FIELD = { type: "INT32", compression: "SNAPPY" } as const;
const INT64_FIELD = { type: "INT64", compression: "SNAPPY" } as const;

export function createSbtcEventsParquetSchema(): ParquetSchema {
	return new ParquetSchema({
		cursor: STRING_FIELD,
		block_height: INT64_FIELD,
		block_time: STRING_FIELD,
		tx_id: STRING_FIELD,
		tx_index: INT32_FIELD,
		event_index: INT32_FIELD,
		topic: STRING_FIELD,
		request_id: { ...INT64_FIELD, optional: true },
		amount: { ...STRING_FIELD, optional: true },
		sender: { ...STRING_FIELD, optional: true },
		recipient_btc_version: { ...INT32_FIELD, optional: true },
		recipient_btc_hashbytes: { ...STRING_FIELD, optional: true },
		bitcoin_txid: { ...STRING_FIELD, optional: true },
		output_index: { ...INT32_FIELD, optional: true },
		sweep_txid: { ...STRING_FIELD, optional: true },
		burn_hash: { ...STRING_FIELD, optional: true },
		burn_height: { ...INT64_FIELD, optional: true },
		signer_bitmap: { ...STRING_FIELD, optional: true },
		max_fee: { ...STRING_FIELD, optional: true },
		fee: { ...STRING_FIELD, optional: true },
		block_height_at_request: { ...INT64_FIELD, optional: true },
		governance_contract_type: { ...INT32_FIELD, optional: true },
		governance_new_contract: { ...STRING_FIELD, optional: true },
		signer_aggregate_pubkey: { ...STRING_FIELD, optional: true },
		signer_threshold: { ...INT32_FIELD, optional: true },
		signer_address: { ...STRING_FIELD, optional: true },
		signer_keys_count: { ...INT32_FIELD, optional: true },
		partition_block_range: STRING_FIELD,
	});
}

export function createSbtcEventsSchemaDocument(
	network: string,
): SbtcEventsSchemaDocument {
	return {
		dataset: SBTC_EVENTS_DATASET,
		version: SBTC_EVENTS_VERSION,
		schema_version: SBTC_EVENTS_SCHEMA_VERSION,
		network,
		columns: SBTC_EVENTS_SCHEMA_COLUMNS,
	};
}
