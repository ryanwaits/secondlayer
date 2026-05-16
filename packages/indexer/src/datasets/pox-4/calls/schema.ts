import type { DatasetParquetColumn } from "../../_shared/parquet.ts";

export const POX4_CALLS_DATASET = "pox-4/calls";
export const POX4_CALLS_VERSION = "v0";
export const POX4_CALLS_SCHEMA_VERSION = 0;

export const POX4_CALLS_SCHEMA_COLUMNS = [
	{
		name: "cursor",
		type: "string",
		nullable: false,
		description: "Streams cursor in <block_height>:<tx_index> form.",
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
		name: "burn_block_height",
		type: "int64",
		nullable: false,
		description: "Bitcoin burn block height at the time of the call.",
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
		name: "function_name",
		type: "string",
		nullable: false,
		description:
			"PoX-4 function invoked (stack-stx, delegate-stx, set-signer-key-authorization, etc.).",
	},
	{
		name: "caller",
		type: "string",
		nullable: false,
		description: "Stacks principal that signed the transaction.",
	},
	{
		name: "stacker",
		type: "string",
		nullable: true,
		description: "Stacking principal (caller for solo, delegated for delegate-*).",
	},
	{
		name: "delegate_to",
		type: "string",
		nullable: true,
		description: "Delegate principal on delegate-stx calls.",
	},
	{
		name: "amount_ustx",
		type: "string",
		nullable: true,
		description: "Amount in microSTX as decimal string (preserves u128 precision).",
	},
	{
		name: "lock_period",
		type: "int32",
		nullable: true,
		description: "Number of reward cycles the funds are locked for.",
	},
	{
		name: "pox_addr_version",
		type: "int32",
		nullable: true,
		description: "PoX BTC address version byte.",
	},
	{
		name: "pox_addr_hashbytes",
		type: "string",
		nullable: true,
		description: "Hex-encoded PoX BTC address hashbytes.",
	},
	{
		name: "pox_addr_btc",
		type: "string",
		nullable: true,
		description: "Decoded Bitcoin address string (p2pkh / p2sh / p2wpkh / p2wsh / p2tr).",
	},
	{
		name: "start_cycle",
		type: "int32",
		nullable: true,
		description: "First reward cycle this stacking call covers.",
	},
	{
		name: "end_cycle",
		type: "int32",
		nullable: true,
		description: "Last reward cycle this stacking call covers (inclusive).",
	},
	{
		name: "signer_key",
		type: "string",
		nullable: true,
		description: "Hex-encoded signer pubkey.",
	},
	{
		name: "signer_signature",
		type: "string",
		nullable: true,
		description: "Hex-encoded signer signature.",
	},
	{
		name: "auth_id",
		type: "string",
		nullable: true,
		description: "Authorization id used to bind a signer key to a stacker action.",
	},
	{
		name: "max_amount",
		type: "string",
		nullable: true,
		description: "Maximum ustx the signer authorized (decimal string).",
	},
	{
		name: "reward_cycle",
		type: "int32",
		nullable: true,
		description: "Reward cycle for aggregation-commit and signer-auth calls.",
	},
	{
		name: "aggregated_amount_ustx",
		type: "string",
		nullable: true,
		description: "Aggregated amount for stack-aggregation-commit-* calls (decimal string).",
	},
	{
		name: "aggregated_signer_index",
		type: "int32",
		nullable: true,
		description: "Signer set index returned by stack-aggregation-commit-indexed.",
	},
	{
		name: "auth_period",
		type: "int32",
		nullable: true,
		description: "Number of cycles a signer-key authorization spans.",
	},
	{
		name: "auth_topic",
		type: "string",
		nullable: true,
		description:
			"Signer-key authorization topic (stack-stx | stack-extend | agg-commit | agg-increase).",
	},
	{
		name: "auth_allowed",
		type: "boolean",
		nullable: true,
		description: "Whether the signer-key authorization grants or revokes permission.",
	},
	{
		name: "result_ok",
		type: "boolean",
		nullable: false,
		description: "True when the PoX-4 call returned (ok ...); false on (err ...).",
	},
	{
		name: "result_raw",
		type: "string",
		nullable: false,
		description: "Hex-encoded raw Clarity response tuple.",
	},
	{
		name: "partition_block_range",
		type: "string",
		nullable: false,
		description: "Zero-padded inclusive block range covered by the parquet file.",
	},
] as const satisfies readonly DatasetParquetColumn[];
