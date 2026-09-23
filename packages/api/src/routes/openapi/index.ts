import { TRAIT_STANDARDS } from "@secondlayer/stacks/clarity";
import { ALL_INDEX_EVENT_TYPES } from "../../index/events.ts";
import { FT_TRANSFER_FIELDS } from "../../index/ft-transfers.ts";
import { NFT_TRANSFER_FIELDS } from "../../index/nft-transfers.ts";
import { TRANSACTION_FIELDS } from "../../index/transactions.ts";
import {
	CONTRACT_ID_PARAM,
	ERROR_401,
	ERROR_429,
	INDEX_RANGE_PARAMS,
	READ_SECURITY,
	envelope,
	json200,
	jsonError,
	pp,
	qp,
} from "./shared.ts";

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const LIMIT = { $ref: "#/components/parameters/Limit" };
const list = (values: readonly string[]) =>
	values.map((v) => `\`${v}\``).join(", ");

/** Feeds keyed on `(block_height, tx_index)` share the window params but not
 *  the cursor's second component (`_shared.ts` `parseTxIndexCursor`). */
const TX_RANGE_PARAMS = INDEX_RANGE_PARAMS.map((p) =>
	p.name === "cursor"
		? {
				...p,
				description:
					"`<block_height>:<tx_index>` from a previous page's `next_cursor`. Resumes after it.",
			}
		: p,
);

/** Blocks, the canonical map and the mempool never return `reorgs`. */
function envelopeWithoutReorgs(
	arrayKey: string,
	item: Record<string, unknown>,
) {
	const out = envelope(arrayKey, item);
	const schema = out["200"].content["application/json"].schema;
	const { reorgs: _reorgs, ...properties } = schema.properties;
	return {
		...out,
		"200": {
			...out["200"],
			content: {
				"application/json": { schema: { ...schema, properties } },
			},
		},
	};
}

/** Point reads: no query params to refuse, so no 400. */
function pointResponses(
	success: Record<string, unknown>,
	notFound: string,
): Record<string, unknown> {
	return {
		"200": success,
		"401": jsonError(ERROR_401),
		"404": jsonError(notFound),
		"429": jsonError(ERROR_429),
	};
}

const TRAIT_PARAM = {
	...qp(
		"trait",
		"string",
		false,
		"Only contracts that declare or implement this SIP standard, resolved as of the page's `to_height`. Mutually exclusive with `contract_id`.",
	),
	schema: { type: "string", enum: [...TRAIT_STANDARDS] },
};

/** Event types only an unreleased node emits. The route accepts them; the
 *  public reference doesn't advertise them until that node ships. */
const UNRELEASED_EVENT_TYPES: ReadonlySet<string> = new Set([
	"nested_contract_call",
	"var_set",
	"map_set",
	"map_insert",
	"map_delete",
]);

const PUBLIC_EVENT_TYPES = ALL_INDEX_EVENT_TYPES.filter(
	(t) => !UNRELEASED_EVENT_TYPES.has(t),
);

/** A real tip snapshot from mainnet, used in the single-resource examples. */
const TIP_EXAMPLE = {
	block_height: 9048938,
	finalized_height: 9048671,
	lag_seconds: 23,
	source_block_height: 9048938,
};

// ── Examples: real mainnet rows, shaped by each route's serializer ──

const BLOCK_EXAMPLE = {
	cursor: "9048502:0",
	block_height: 9048502,
	block_hash:
		"0x2a20974330e301b65086d3cde9b0006c9b7471479ba9a3fc2ca72621479655cc",
	parent_hash:
		"0x10606e958095ef9b964e3c3f2d9eb75bf8577fb8c09c24ee492b767f7504abea",
	burn_block_height: 968276,
	burn_block_hash:
		"0x000000000000000000019d25cd76d06a9eea796a906ac88300cd70fd70ccdb57",
	index_block_hash:
		"0x990152a894e12288960c8b68e5790ad7994f9d261e9ad8adc13c72e76f914339",
	block_time: "2026-09-23T13:14:42.000Z",
	canonical: true,
};

const TRANSACTION_EXAMPLE = {
	cursor: "9048502:1",
	tx_id: "0x198d642edb1104a1757a8c353ad61231d0422ecb6ba83aa1ce45d05df44157e0",
	block_height: 9048502,
	block_time: "2026-09-23T13:14:42.000Z",
	burn_block_height: 968276,
	tx_index: 1,
	tx_type: "contract_call",
	sender: "SP15T1W26JTNS26VG17HM468KW7TQD3124KTYA9EJ",
	status: "success",
	fee: "3000",
	nonce: "265",
	sponsored: false,
	anchor_mode: "any",
	post_condition_mode: "deny",
	post_conditions: [
		{
			type: "ft",
			principal: "SP15T1W26JTNS26VG17HM468KW7TQD3124KTYA9EJ",
			asset_identifier:
				"SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token",
			condition_code: 1,
			condition_code_name: "sent_eq",
			amount: "300",
		},
	],
	contract_call: {
		contract_id: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token",
		function_name: "transfer",
		function_args: [
			"300",
			"SP15T1W26JTNS26VG17HM468KW7TQD3124KTYA9EJ",
			"SPD3SCZDZ52X4ZX1878XWBFBJ29YRX0MFW9Z9W4V",
			null,
		],
		function_args_hex: [
			"010000000000000000000000000000012c",
			"05164ba0f04696ab911b7009e3421913e1f5768c2224",
			"05161a3cb3edf945d27fa141d1de2deb9093ec74147f",
			"09",
		],
		result: true,
		result_hex: "0x0703",
	},
};

const MEMPOOL_EXAMPLE = {
	cursor: "bToyNjg4Mjc0",
	tx_id: "0x00a5cd852c25c5bb5cc7f97c60b88a6a635c001ad431e2133f366be85d5ce0f0",
	tx_type: "token_transfer",
	sender: "SM1Z09F6431EQT8GCTEF496TCT5JDTPJ3VFF9Q766",
	received_at: "2026-09-23T15:11:05.629Z",
	fee: "1732",
	nonce: "37",
	sponsored: false,
	anchor_mode: "any",
	post_condition_mode: "deny",
	post_conditions: [],
	token_transfer: {
		recipient: "SMJWA5YRH2DRANX3V96Z6JJSFBE03Z9Y0WHN3XSQ",
		amount: "79559850769",
		memo: "572826509",
	},
};

/** Chain reads: events, transfers, blocks, transactions, mempool. */
export const indexPaths = {
	"/v1/index": {
		get: {
			tags: ["index"],
			summary: "Index discovery",
			description:
				"Lists every Index route with its accepted filters, plus the per-`event_type` column and filter vocabulary for `/v1/index/events`. Open: it runs before auth, so it never needs a token.",
			security: READ_SECURITY,
			responses: {
				"200": json200(ref("IndexDiscovery"), "Index routes and filters"),
			},
		},
	},
	"/v1/index/events": {
		get: {
			tags: ["index"],
			summary: "Decoded events by event_type",
			description:
				"One `event_type` per request, oldest first. Which filters and `fields` apply depends on the type; anything a type does not accept is refused.",
			security: READ_SECURITY,
			parameters: [
				{
					...qp(
						"event_type",
						"string",
						true,
						"The event type to read. Required, unless you pass `types` instead.",
					),
					schema: { type: "string", enum: [...PUBLIC_EVENT_TYPES] },
				},
				qp(
					"types",
					"string",
					false,
					"Alias for `event_type`, the Streams spelling. Takes one value; a comma-separated set is refused. Mutually exclusive with `event_type`.",
				),
				LIMIT,
				...INDEX_RANGE_PARAMS,
				CONTRACT_ID_PARAM,
				TRAIT_PARAM,
				qp(
					"asset_identifier",
					"string",
					false,
					"Asset identifier (`<contract>::<asset>`). ft and nft transfer, mint and burn types only.",
				),
				qp(
					"sender",
					"string",
					false,
					"Sending principal. Types with a sender only; on `stx_lock` it is the locked address.",
				),
				qp(
					"recipient",
					"string",
					false,
					"Receiving principal. Types with a recipient only.",
				),
				qp(
					"tx_id",
					"string",
					false,
					"Transaction id. VM types only: nested_contract_call, var_set, map_set, map_insert, map_delete.",
				),
				qp("function_name", "string", false, "nested_contract_call only."),
				qp("caller", "string", false, "nested_contract_call only."),
				qp(
					"map",
					"string",
					false,
					"map_set, map_insert, map_delete. Matches map_name.",
				),
				qp("var_name", "string", false, "var_set only."),
				qp(
					"tx_context",
					"boolean",
					false,
					"`true` adds the submitting transaction's `tx_sender`, `tx_type`, `tx_status`, `tx_contract_id` and `tx_function_name` to each row.",
				),
				qp(
					"fields",
					"string",
					false,
					"Comma-separated columns to return: the universal ones, the type's own columns, and the `tx_*` columns when `tx_context=true`. `cursor`, `block_height` and `event_type` always come back; an unknown name is refused. Leaving out `block_time` skips a join.",
				),
			],
			responses: envelope("events", ref("IndexEvent")),
		},
	},
	"/v1/index/ft-transfers": {
		get: {
			tags: ["index"],
			summary: "Fungible token transfers",
			description:
				"Same rows as `/v1/index/events?event_type=ft_transfer`, oldest first, with a typed row. Filters combine with AND.",
			security: READ_SECURITY,
			parameters: [
				LIMIT,
				...INDEX_RANGE_PARAMS,
				qp(
					"contract_id",
					"string",
					false,
					"Token contract. One principal; no comma-separated set here.",
				),
				qp(
					"asset_identifier",
					"string",
					false,
					"Asset identifier (`<contract>::<asset>`).",
				),
				qp("sender", "string", false, "Sending principal."),
				qp("recipient", "string", false, "Receiving principal."),
				qp(
					"fields",
					"string",
					false,
					`Comma-separated columns to return, from ${list(FT_TRANSFER_FIELDS)} and \`event_type\`. \`cursor\` and \`block_height\` always come back; an unknown name is refused.`,
				),
			],
			responses: envelope("events", ref("FtTransfer")),
		},
	},
	"/v1/index/nft-transfers": {
		get: {
			tags: ["index"],
			summary: "NFT transfers",
			description:
				"Same rows as `/v1/index/events?event_type=nft_transfer`, oldest first, with a typed row. Filters combine with AND.",
			security: READ_SECURITY,
			parameters: [
				LIMIT,
				...INDEX_RANGE_PARAMS,
				qp(
					"contract_id",
					"string",
					false,
					"NFT contract. One principal; no comma-separated set here.",
				),
				qp(
					"asset_identifier",
					"string",
					false,
					"Asset identifier (`<contract>::<asset>`).",
				),
				qp("sender", "string", false, "Sending principal."),
				qp("recipient", "string", false, "Receiving principal."),
				qp(
					"fields",
					"string",
					false,
					`Comma-separated columns to return, from ${list(NFT_TRANSFER_FIELDS)} and \`event_type\`. \`cursor\` and \`block_height\` always come back; an unknown name is refused.`,
				),
			],
			responses: envelope("events", ref("NftTransfer")),
		},
	},
	"/v1/index/contract-calls": {
		get: {
			tags: ["index"],
			summary: "Decoded contract-call transactions",
			description:
				"Top-level `contract_call` transactions in canonical blocks, oldest first, with arguments and result decoded. Failed calls are included; check `status`. The cursor is `<block_height>:<tx_index>`. `reorgs` covers every height on the page.",
			security: READ_SECURITY,
			parameters: [
				LIMIT,
				...TX_RANGE_PARAMS,
				CONTRACT_ID_PARAM,
				TRAIT_PARAM,
				qp("function_name", "string", false, "Called function. Exact match."),
				qp(
					"sender",
					"string",
					false,
					"Transaction sender principal. Exact match.",
				),
			],
			responses: envelope("contract_calls", ref("ContractCall")),
		},
	},
	"/v1/index/canonical": {
		get: {
			tags: ["index"],
			summary: "Canonical block-hash map",
			description:
				"One row per height on the canonical chain, oldest first. Orphaned blocks never appear, so you can check your own chain against it. Lean by design; `/v1/index/blocks` is the full block. Not metered.",
			security: READ_SECURITY,
			parameters: [LIMIT, ...INDEX_RANGE_PARAMS],
			responses: envelopeWithoutReorgs("canonical", ref("CanonicalBlock")),
		},
	},
	"/v1/index/blocks": {
		get: {
			tags: ["index"],
			summary: "Canonical blocks",
			description:
				"Canonical blocks, oldest first. The cursor is `<block_height>:0`. The window follows the ingest tip, so it can run ahead of the decoded `tip.block_height`.",
			security: READ_SECURITY,
			parameters: [LIMIT, ...INDEX_RANGE_PARAMS],
			responses: envelopeWithoutReorgs("blocks", ref("Block")),
		},
	},
	"/v1/index/blocks/{height_or_hash}": {
		get: {
			tags: ["index"],
			summary: "Block by height or hash",
			description:
				"A height returns the canonical block there. A hash returns that block whether or not it is canonical, so check `canonical` to spot an orphan. Not metered.",
			security: READ_SECURITY,
			parameters: [
				{
					...pp(
						"height_or_hash",
						"A block height (digits only) or a `0x`-prefixed block hash.",
					),
					schema: { type: "string", example: "9048502" },
				},
			],
			responses: pointResponses(
				json200(
					{
						type: "object",
						required: ["block", "tip"],
						properties: {
							block: ref("Block"),
							tip: ref("Tip"),
						},
						example: {
							block: BLOCK_EXAMPLE,
							tip: TIP_EXAMPLE,
						},
					},
					"The block and the tip it was read against",
				),
				"No block at that height or with that hash (`Block not found`)",
			),
		},
	},
	"/v1/index/transactions": {
		get: {
			tags: ["index"],
			summary: "Full transaction documents",
			description:
				"Transactions in canonical blocks, oldest first, with fee, nonce, post-conditions and payload detail decoded from the raw bytes. Filters combine with AND. The cursor is `<block_height>:<tx_index>`. `reorgs` covers every height on the page.",
			security: READ_SECURITY,
			parameters: [
				LIMIT,
				...TX_RANGE_PARAMS,
				qp(
					"type",
					"string",
					false,
					"Transaction type as stored, e.g. `contract_call`, `token_transfer`, `smart_contract`, `coinbase`, `tenure_change`. Exact match.",
				),
				qp("sender", "string", false, "Sender principal. Exact match."),
				qp(
					"contract_id",
					"string",
					false,
					"Called or deployed contract. One principal. Exact match.",
				),
				qp(
					"fields",
					"string",
					false,
					`Comma-separated columns to return, from ${list(TRANSACTION_FIELDS)}. \`cursor\`, \`block_height\` and \`tx_id\` always come back; an unknown name is refused.`,
				),
			],
			responses: envelope("transactions", ref("Transaction")),
		},
	},
	"/v1/index/transactions/{tx_id}": {
		get: {
			tags: ["index"],
			summary: "Transaction by tx_id",
			description:
				"One transaction document, only if it sits in a canonical block. A transaction still pending is at `/v1/index/mempool/{tx_id}`. Not metered.",
			security: READ_SECURITY,
			parameters: [pp("tx_id", "Transaction id, `0x`-prefixed hex.")],
			responses: pointResponses(
				json200(
					{
						type: "object",
						required: ["transaction", "tip"],
						properties: {
							transaction: ref("Transaction"),
							tip: ref("Tip"),
						},
						example: {
							transaction: TRANSACTION_EXAMPLE,
							tip: TIP_EXAMPLE,
						},
					},
					"The transaction and the tip it was read against",
				),
				"No canonical transaction with that id (`Transaction not found`)",
			),
		},
	},
	"/v1/index/transactions/{tx_id}/proof": {
		get: {
			tags: ["index"],
			summary:
				"Trustless tx-inclusion proof (raw tx, Nakamoto header, merkle path)",
			description:
				"What you need to check, without trusting this API, that a transaction is in a signed Nakamoto block: the raw tx, the raw block header, and the tx merkle path. `consensus` adds the cycle's signer set when the node can resolve it. The SDK's `verifyTransactionProof` runs every check. The instance must reach its Stacks node. Immutable once served.",
			security: READ_SECURITY,
			parameters: [pp("tx_id", "Transaction id, `0x`-prefixed hex.")],
			responses: {
				"200": json200(ref("TransactionProof"), "The inclusion proof"),
				"401": jsonError(ERROR_401),
				"404": jsonError(
					"The transaction or its block is not indexed or not on the node (`PROOF_UNAVAILABLE`)",
				),
				"429": jsonError(ERROR_429),
				"503": jsonError(
					"The Stacks node is unreachable (`PROOF_NODE_UNAVAILABLE`), or the stored transactions do not reproduce the block's merkle root (`PROOF_TX_SET_INCOMPLETE`)",
				),
			},
		},
	},
	"/v1/index/mempool": {
		get: {
			tags: ["index"],
			summary: "Pending (unconfirmed) transactions",
			description:
				"Pending transactions this instance's node has seen since the observer connected, in arrival order. A single-node, go-forward view: the backlog from before the observer connected is never replayed. Confirmed transactions leave the list. No height window. Never cached.",
			security: READ_SECURITY,
			parameters: [
				LIMIT,
				{
					...qp(
						"cursor",
						"string",
						false,
						"Opaque `next_cursor` from a previous page. Pass it back unchanged. Mutually exclusive with `from_cursor`.",
					),
					schema: { type: "string", example: "bToyNjg4Mjc0" },
				},
				qp("from_cursor", "string", false, "Same as `cursor`."),
				qp("sender", "string", false, "Sender principal. Exact match."),
				qp(
					"type",
					"string",
					false,
					"Transaction type as stored, e.g. `contract_call`, `token_transfer`. Exact match.",
				),
				qp("contract_id", "string", false, "Called contract. Exact match."),
				qp("function_name", "string", false, "Called function. Exact match."),
			],
			responses: mempoolEnvelope(),
		},
	},
	"/v1/index/mempool/{tx_id}": {
		get: {
			tags: ["index"],
			summary: "Pending transaction by tx_id",
			description:
				"One pending transaction. It 404s once the transaction confirms (read it from `/v1/index/transactions/{tx_id}`) or drops. Never cached.",
			security: READ_SECURITY,
			parameters: [pp("tx_id", "Transaction id, `0x`-prefixed hex.")],
			responses: pointResponses(
				json200(
					{
						type: "object",
						required: ["transaction", "tip"],
						properties: {
							transaction: ref("MempoolTransaction"),
							tip: ref("Tip"),
						},
						example: {
							transaction: MEMPOOL_EXAMPLE,
							tip: TIP_EXAMPLE,
						},
					},
					"The pending transaction and the current tip",
				),
				"Not pending on this instance: confirmed, dropped, or never seen (`Pending transaction not found`)",
			),
		},
	},
	"/v1/index/contracts/{contract_id}/print-schema": {
		get: {
			tags: ["index"],
			summary: "Empirical per-topic print payload schemas for a contract",
			description:
				"Infers the shape of a contract's `print` payloads from its canonical print events, grouped by the tuple's `topic` field. Reads the newest 1500 and oldest 500 events, so fields the contract stopped emitting still show. Takes no query parameters. Held in memory for 5 minutes per contract. Not metered.",
			security: READ_SECURITY,
			parameters: [
				{
					...pp(
						"contract_id",
						"Contract principal, `<address>.<name>`. Anything that does not look like one is refused.",
					),
					schema: {
						type: "string",
						example:
							"SP2BM6AQSMQ04CX8KDE62QBFVZTDZ2ZX80GZJSBZ4.zc-claim-helper-v2",
					},
				},
			],
			responses: {
				"200": json200(ref("PrintSchema"), "Inferred print schemas"),
				"400": jsonError(
					"`contract_id` is not a contract principal, or a query parameter was sent (`VALIDATION_ERROR`)",
				),
				"401": jsonError(ERROR_401),
				"429": jsonError(ERROR_429),
			},
		},
	},
};

/** Mempool cursors are opaque, not `<block_height>:<n>`. */
function mempoolEnvelope() {
	const out = envelopeWithoutReorgs("mempool", ref("MempoolTransaction"));
	const schema = out["200"].content["application/json"].schema;
	return {
		...out,
		"200": {
			...out["200"],
			content: {
				"application/json": {
					schema: {
						...schema,
						properties: {
							...schema.properties,
							next_cursor: {
								type: ["string", "null"],
								description:
									"The last row's opaque cursor. Pass it back as `cursor` to continue. `null` when the page is empty.",
								example: "bToyNjg4Mjc0",
							},
						},
					},
				},
			},
		},
	};
}

// ── Shared property fragments ──

const CURSOR_PROP = {
	type: "string",
	description: "`<block_height>:<event_index>`. Pass as `cursor`.",
};
const TX_CURSOR_PROP = {
	type: "string",
	description: "`<block_height>:<tx_index>`. Pass as `cursor`.",
};
const BLOCK_HEIGHT_PROP = {
	type: "integer",
	description: "Stacks block the row landed in.",
};
const BLOCK_TIME_PROP = {
	type: ["string", "null"],
	format: "date-time",
	description: "That block's timestamp, ISO 8601 UTC.",
};
const TX_ID_PROP = {
	type: "string",
	description: "Transaction id, `0x`-prefixed hex.",
};
const TX_INDEX_PROP = {
	type: "integer",
	description: "The transaction's position in its block.",
};
const EVENT_INDEX_PROP = {
	type: "integer",
	description:
		"The event's position in the block. With `block_height`, the cursor.",
};

/** Fields shared by the confirmed and pending transaction documents. */
const TX_DECODED_PROPS = {
	tx_type: {
		type: "string",
		description:
			"`token_transfer`, `contract_call`, `smart_contract`, `coinbase`, `tenure_change` or `poison_microblock`, decoded from the raw bytes. Falls back to the stored type when they do not decode.",
	},
	sender: { type: "string", description: "Sender principal." },
	fee: {
		type: ["string", "null"],
		description:
			"Fee in microSTX as a decimal string. `null` when the raw bytes do not decode.",
	},
	nonce: {
		type: ["string", "null"],
		description: "Sender nonce as a decimal string.",
	},
	sponsored: {
		type: ["boolean", "null"],
		description: "Whether a sponsor paid the fee.",
	},
	anchor_mode: {
		type: ["string", "null"],
		enum: ["on_chain_only", "off_chain_only", "any", null],
		description: "Anchor mode from the raw bytes.",
	},
	post_condition_mode: {
		type: ["string", "null"],
		enum: ["allow", "deny", null],
		description: "Post-condition mode from the raw bytes.",
	},
	post_conditions: {
		type: "array",
		items: ref("PostCondition"),
		description: "Decoded post-conditions. Empty when there are none.",
	},
	token_transfer: {
		type: "object",
		description: "`token_transfer` only.",
		properties: {
			recipient: { type: "string", description: "Receiving principal." },
			amount: {
				type: "string",
				description: "microSTX as a decimal string.",
			},
			memo: { type: "string", description: "Memo, empty when unset." },
		},
	},
	coinbase: {
		type: "object",
		description: "`coinbase` only.",
		properties: {
			alt_recipient: {
				type: ["string", "null"],
				description: "Alternate reward recipient, if set.",
			},
		},
	},
	tenure_change: {
		type: "object",
		description: "`tenure_change` only.",
		properties: {
			cause: { type: "integer", description: "Tenure-change cause code." },
		},
	},
};

/** Resource schemas for these rows, merged into `components.schemas`. */
export const indexSchemas = {
	IndexEvent: {
		type: "object",
		description:
			"One decoded event, flat. The universal columns are always there; the rest depend on `event_type`, and a type's own columns are always set for its rows.",
		required: [
			"cursor",
			"block_height",
			"tx_id",
			"tx_index",
			"event_index",
			"event_type",
			"contract_id",
		],
		properties: {
			cursor: {
				type: "string",
				description: "`<block_height>:<event_index>`. Pass as `cursor`.",
			},
			block_height: BLOCK_HEIGHT_PROP,
			block_time: BLOCK_TIME_PROP,
			tx_id: TX_ID_PROP,
			tx_index: TX_INDEX_PROP,
			event_index: {
				type: "integer",
				description:
					"The event's position in the block. With `block_height`, the cursor.",
			},
			event_type: {
				type: "string",
				enum: [...PUBLIC_EVENT_TYPES],
				description: "The event type. Decides which columns are set.",
			},
			contract_id: {
				type: ["string", "null"],
				description:
					"Contract that emitted the event. `null` for STX transfers, mints, burns and locks.",
			},
			asset_identifier: {
				type: ["string", "null"],
				description: "`<contract>::<asset>`, on ft and nft types.",
			},
			sender: {
				type: ["string", "null"],
				description: "Sending principal. The locked address on `stx_lock`.",
			},
			recipient: {
				type: ["string", "null"],
				description: "Receiving principal.",
			},
			amount: {
				type: ["string", "null"],
				description:
					"Amount as a decimal string (bigint-safe). microSTX on STX types.",
			},
			value: {
				type: ["string", "null"],
				description: "NFT id as hex-encoded Clarity, on nft types.",
			},
			memo: {
				type: ["string", "null"],
				description: "Transfer memo, on `stx_transfer`.",
			},
			payload: {
				description:
					"Decoded print payload on `print`; `{ unlock_height }` on `stx_lock`.",
			},
			tx_sender: {
				type: ["string", "null"],
				description:
					"Submitting transaction's sender. Only with `tx_context=true`.",
			},
			tx_type: {
				type: ["string", "null"],
				description:
					"Submitting transaction's type. Only with `tx_context=true`.",
			},
			tx_status: {
				type: ["string", "null"],
				description:
					"Submitting transaction's status. Only with `tx_context=true`.",
			},
			tx_contract_id: {
				type: ["string", "null"],
				description:
					"Contract the submitting transaction called or deployed. Only with `tx_context=true`.",
			},
			tx_function_name: {
				type: ["string", "null"],
				description:
					"Function the submitting transaction called. Only with `tx_context=true`.",
			},
		},
		example: {
			cursor: "9048921:2",
			block_height: 9048921,
			block_time: "2026-09-23T15:09:05.000Z",
			tx_id:
				"0x55249ff4ec221ff6852b7fa37cf3729c7c50bc63f0da760f96e6886e2e8a911e",
			tx_index: 4,
			event_index: 2,
			event_type: "stx_transfer",
			contract_id: null,
			sender: "SPX4KR3G5Z1SZT4RVF4ATHV4ZP4KXPWSZ4424W6K",
			recipient: "SP2Z2CBMGWB9MQZAF5Z8X56KS69XRV3SJF4WKJ7J9",
			amount: "50",
			memo: null,
		},
	},
	FtTransfer: {
		type: "object",
		description: "One fungible token transfer.",
		required: [
			"cursor",
			"block_height",
			"tx_id",
			"tx_index",
			"event_index",
			"event_type",
			"contract_id",
			"asset_identifier",
			"sender",
			"recipient",
			"amount",
		],
		properties: {
			cursor: CURSOR_PROP,
			block_height: BLOCK_HEIGHT_PROP,
			block_time: BLOCK_TIME_PROP,
			tx_id: TX_ID_PROP,
			tx_index: TX_INDEX_PROP,
			event_index: EVENT_INDEX_PROP,
			event_type: {
				type: "string",
				enum: ["ft_transfer"],
				description: "Always `ft_transfer`.",
			},
			contract_id: { type: "string", description: "Token contract." },
			asset_identifier: {
				type: "string",
				description: "`<contract>::<asset>`.",
			},
			sender: { type: "string", description: "Sending principal." },
			recipient: { type: "string", description: "Receiving principal." },
			amount: {
				type: "string",
				description:
					"Amount in the token's base units, as a decimal string (bigint-safe).",
			},
		},
		example: {
			cursor: "9048918:3",
			block_height: 9048918,
			block_time: "2026-09-23T15:08:18.000Z",
			tx_id:
				"0xc342cb7616498a84a8dcfac62a991c31c037d8c6f98a11f987f0719fd619e672",
			tx_index: 2,
			event_index: 3,
			event_type: "ft_transfer",
			contract_id: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token",
			asset_identifier:
				"SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token",
			sender: "SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.v0-8-market",
			recipient: "SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.v0-vault-sbtc",
			amount: "15000",
		},
	},
	NftTransfer: {
		type: "object",
		description: "One NFT transfer.",
		required: [
			"cursor",
			"block_height",
			"tx_id",
			"tx_index",
			"event_index",
			"event_type",
			"contract_id",
			"asset_identifier",
			"sender",
			"recipient",
			"value",
		],
		properties: {
			cursor: CURSOR_PROP,
			block_height: BLOCK_HEIGHT_PROP,
			block_time: BLOCK_TIME_PROP,
			tx_id: TX_ID_PROP,
			tx_index: TX_INDEX_PROP,
			event_index: EVENT_INDEX_PROP,
			event_type: {
				type: "string",
				enum: ["nft_transfer"],
				description: "Always `nft_transfer`.",
			},
			contract_id: { type: "string", description: "NFT contract." },
			asset_identifier: {
				type: "string",
				description: "`<contract>::<asset>`.",
			},
			sender: { type: "string", description: "Sending principal." },
			recipient: { type: "string", description: "Receiving principal." },
			value: {
				type: "string",
				description: "The token id as hex-encoded Clarity.",
			},
		},
		example: {
			cursor: "9048916:0",
			block_height: 9048916,
			block_time: "2026-09-23T15:07:41.000Z",
			tx_id:
				"0x269d7877002b998ad3a3ee35f661610cc8f2be6eec604905311d52cf1cf80caa",
			tx_index: 0,
			event_index: 0,
			event_type: "nft_transfer",
			contract_id:
				"SPVD6CE8RW90BGGKJZTKCSMGKS7HP0K8364TFR48.bitcoin-faces-airdrop",
			asset_identifier:
				"SPVD6CE8RW90BGGKJZTKCSMGKS7HP0K8364TFR48.bitcoin-faces-airdrop::bitcoin-faces",
			sender: "SP3KMHQ80ZGT037R2FCHV1F7Z0X25EV6GVEYNAB87",
			recipient: "SP37YJNKVKP3KD5SFK71NW7DC25RRF4HKWWQRH3NT",
			value: "0x010000000000000000000000000008331e",
		},
	},
	ContractCall: {
		type: "object",
		description:
			"One top-level contract-call transaction, arguments and result decoded to JSON. Clarity integers come back as decimal strings.",
		required: [
			"cursor",
			"block_height",
			"tx_id",
			"tx_index",
			"contract_id",
			"function_name",
			"sender",
			"status",
			"args",
			"result",
			"result_hex",
		],
		properties: {
			cursor: TX_CURSOR_PROP,
			block_height: BLOCK_HEIGHT_PROP,
			block_time: BLOCK_TIME_PROP,
			tx_id: TX_ID_PROP,
			tx_index: TX_INDEX_PROP,
			contract_id: { type: "string", description: "Called contract." },
			function_name: { type: "string", description: "Called function." },
			sender: { type: "string", description: "Transaction sender principal." },
			status: {
				type: "string",
				description: "Execution status, e.g. `success` or `abort_by_response`.",
			},
			args: {
				type: "array",
				items: {},
				description: "Decoded arguments, in call order.",
			},
			result: {
				description: "Decoded result. `null` when there is none.",
			},
			result_hex: {
				type: ["string", "null"],
				description: "The result as hex-encoded Clarity.",
			},
		},
		example: {
			cursor: "9048502:1",
			block_height: 9048502,
			block_time: "2026-09-23T13:14:42.000Z",
			tx_id:
				"0x198d642edb1104a1757a8c353ad61231d0422ecb6ba83aa1ce45d05df44157e0",
			tx_index: 1,
			contract_id: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token",
			function_name: "transfer",
			sender: "SP15T1W26JTNS26VG17HM468KW7TQD3124KTYA9EJ",
			status: "success",
			args: [
				"300",
				"SP15T1W26JTNS26VG17HM468KW7TQD3124KTYA9EJ",
				"SPD3SCZDZ52X4ZX1878XWBFBJ29YRX0MFW9Z9W4V",
				null,
			],
			result: true,
			result_hex: "0x0703",
		},
	},
	CanonicalBlock: {
		type: "object",
		description:
			"One height of the canonical chain: the hash, its parent, and the Bitcoin anchor. Every row is canonical.",
		required: [
			"cursor",
			"block_height",
			"block_hash",
			"parent_hash",
			"burn_block_height",
			"burn_block_hash",
		],
		properties: {
			cursor: {
				type: "string",
				description: "`<block_height>:0`. Pass as `cursor`.",
			},
			block_height: { type: "integer", description: "Stacks block height." },
			block_hash: { type: "string", description: "The block's hash." },
			parent_hash: {
				type: "string",
				description: "The parent block's hash, to check linkage.",
			},
			burn_block_height: {
				type: "integer",
				description: "The Bitcoin block it anchors to.",
			},
			burn_block_hash: {
				type: ["string", "null"],
				description: "That Bitcoin block's hash.",
			},
		},
		example: {
			cursor: "9048503:0",
			block_height: 9048503,
			block_hash:
				"0x5560590afefe994adbe2188586a44ba3668e8964a7e64bb137c0df216531da0c",
			parent_hash:
				"0x2a20974330e301b65086d3cde9b0006c9b7471479ba9a3fc2ca72621479655cc",
			burn_block_height: 968276,
			burn_block_hash:
				"0x000000000000000000019d25cd76d06a9eea796a906ac88300cd70fd70ccdb57",
		},
	},
	Block: {
		type: "object",
		description:
			"A Stacks block: chain linkage and Bitcoin anchor. Only what ingest stores; no miner, tx count or cost data.",
		required: [
			"cursor",
			"block_height",
			"block_hash",
			"parent_hash",
			"burn_block_height",
			"burn_block_hash",
			"index_block_hash",
			"block_time",
			"canonical",
		],
		properties: {
			cursor: {
				type: "string",
				description: "`<block_height>:0`. Pass as `cursor`.",
			},
			block_height: { type: "integer", description: "Stacks block height." },
			block_hash: { type: "string", description: "The block's hash." },
			parent_hash: {
				type: "string",
				description: "The parent block's hash.",
			},
			burn_block_height: {
				type: "integer",
				description: "The Bitcoin block it anchors to.",
			},
			burn_block_hash: {
				type: ["string", "null"],
				description: "That Bitcoin block's hash.",
			},
			index_block_hash: {
				type: ["string", "null"],
				description:
					"Nakamoto block id. Pass it as `?tip=` to a node read-only call to pin the read to this block. `null` on rows ingested before it was stored.",
			},
			block_time: BLOCK_TIME_PROP,
			canonical: {
				type: "boolean",
				description:
					"Whether the block is on the canonical chain. Always `true` in the list; a hash lookup can return an orphan.",
			},
		},
		example: BLOCK_EXAMPLE,
	},
	PostCondition: {
		type: "object",
		description:
			"A decoded post-condition. `type` decides the shape: `stx`, `ft` and `staking` carry `amount`; `ft` and `nft` carry `asset_identifier`; `nft` carries `asset_value`; `pox` carries neither.",
		required: ["type", "principal", "condition_code", "condition_code_name"],
		properties: {
			type: {
				type: "string",
				enum: ["stx", "ft", "nft", "staking", "pox"],
				description: "Post-condition kind.",
			},
			principal: {
				type: "string",
				description: "Principal the condition applies to, or `origin`.",
			},
			condition_code: {
				type: "integer",
				description: "Wire condition code.",
			},
			condition_code_name: {
				type: ["string", "null"],
				description:
					"Its name, e.g. `sent_eq`, `not_sent`, `will_perform`. `null` for an unknown code.",
			},
			amount: {
				type: "string",
				description: "Amount as a decimal string, on `stx`, `ft`, `staking`.",
			},
			asset_identifier: {
				type: "string",
				description: "`<contract>::<asset>`, on `ft` and `nft`.",
			},
			asset_value: {
				description: "The NFT id, decoded, on `nft`.",
			},
		},
		example: {
			type: "ft",
			principal: "SP15T1W26JTNS26VG17HM468KW7TQD3124KTYA9EJ",
			asset_identifier:
				"SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token",
			condition_code: 1,
			condition_code_name: "sent_eq",
			amount: "300",
		},
	},
	Transaction: {
		type: "object",
		description:
			"A confirmed transaction: stored columns plus what decodes from the raw bytes. Payload objects appear only for the matching `tx_type`. Decoded fields are `null` when the raw bytes do not decode (burnchain ops).",
		required: [
			"cursor",
			"tx_id",
			"block_height",
			"tx_index",
			"tx_type",
			"sender",
			"status",
			"fee",
			"nonce",
			"sponsored",
			"anchor_mode",
			"post_condition_mode",
			"post_conditions",
		],
		properties: {
			cursor: TX_CURSOR_PROP,
			tx_id: TX_ID_PROP,
			block_height: BLOCK_HEIGHT_PROP,
			block_time: BLOCK_TIME_PROP,
			burn_block_height: {
				type: ["integer", "null"],
				description: "The Bitcoin block its Stacks block anchors to.",
			},
			tx_index: TX_INDEX_PROP,
			status: {
				type: "string",
				description: "Execution status, e.g. `success` or `abort_by_response`.",
			},
			...TX_DECODED_PROPS,
			contract_call: {
				type: "object",
				description: "`contract_call` only.",
				properties: {
					contract_id: { type: "string", description: "Called contract." },
					function_name: { type: "string", description: "Called function." },
					function_args: {
						type: "array",
						items: {},
						description: "Decoded arguments, in call order.",
					},
					function_args_hex: {
						type: "array",
						items: { type: "string" },
						description: "The same arguments as hex-encoded Clarity.",
					},
					result: { description: "Decoded result. `null` when there is none." },
					result_hex: {
						type: ["string", "null"],
						description: "The result as hex-encoded Clarity.",
					},
				},
			},
			smart_contract: {
				type: "object",
				description: "`smart_contract` only.",
				properties: {
					contract_id: {
						type: ["string", "null"],
						description: "Deployed contract.",
					},
					clarity_version: {
						type: ["integer", "null"],
						description: "Clarity version, `null` when unversioned.",
					},
				},
			},
		},
		example: TRANSACTION_EXAMPLE,
	},
	MempoolTransaction: {
		type: "object",
		description:
			"A pending transaction: the transaction document before it has a block, so no height, index, status or result, plus when this instance first saw it.",
		required: [
			"cursor",
			"tx_id",
			"tx_type",
			"sender",
			"received_at",
			"fee",
			"nonce",
			"sponsored",
			"anchor_mode",
			"post_condition_mode",
			"post_conditions",
		],
		properties: {
			cursor: {
				type: "string",
				description: "Opaque. Pass it back as `cursor` unchanged.",
			},
			tx_id: TX_ID_PROP,
			received_at: {
				type: ["string", "null"],
				format: "date-time",
				description: "When this instance's node first saw it, ISO 8601 UTC.",
			},
			...TX_DECODED_PROPS,
			contract_call: {
				type: "object",
				description: "`contract_call` only. No result yet.",
				properties: {
					contract_id: { type: "string", description: "Called contract." },
					function_name: { type: "string", description: "Called function." },
					function_args: {
						type: "array",
						items: {},
						description: "Decoded arguments, in call order.",
					},
				},
			},
			smart_contract: {
				type: "object",
				description: "`smart_contract` only.",
				properties: {
					clarity_version: {
						type: ["integer", "null"],
						description: "Clarity version, `null` when unversioned.",
					},
				},
			},
		},
		example: MEMPOOL_EXAMPLE,
	},
	TransactionProof: {
		type: "object",
		description:
			"Everything needed to verify inclusion offline. Hex values have no `0x` prefix.",
		required: [
			"txid",
			"index_block_hash",
			"block_height",
			"tx_index",
			"raw_tx",
			"raw_header",
			"tx_merkle_path",
		],
		properties: {
			txid: {
				type: "string",
				description: "Transaction id. Recompute it from `raw_tx`.",
			},
			index_block_hash: {
				type: "string",
				description: "Nakamoto block id. Recompute it from `raw_header`.",
			},
			block_height: { type: "integer", description: "Stacks block height." },
			tx_index: {
				type: "integer",
				description:
					"The transaction's position in the block; the merkle leaf index.",
			},
			raw_tx: { type: "string", description: "The serialized transaction." },
			raw_header: {
				type: "string",
				description:
					"The serialized Nakamoto block header, signer signatures included.",
			},
			tx_merkle_path: {
				type: "array",
				description:
					"Sibling hashes from the leaf up to the header's tx merkle root.",
				items: {
					type: "object",
					properties: {
						position: {
							type: "string",
							enum: ["left", "right"],
							description: "Which side the sibling sits on.",
						},
						hash: { type: "string", description: "Sibling hash." },
					},
				},
			},
			consensus: {
				type: "object",
				description:
					"The reward cycle and its signer set, to check the header's signatures pass 70% of signer weight. Absent when the node cannot resolve the set.",
				properties: {
					reward_cycle: { type: "integer", description: "Reward cycle." },
					reward_set: {
						type: "object",
						description: "Signers and their weights for that cycle.",
						properties: {
							signers: {
								type: "array",
								description: "Each signer's key and weight.",
								items: {
									type: "object",
									properties: {
										signing_key: {
											type: "string",
											description: "33-byte compressed public key, hex.",
										},
										weight: { type: "integer", description: "Signer weight." },
									},
								},
							},
							total_weight: {
								type: "integer",
								description: "Sum of all signer weights.",
							},
						},
					},
				},
			},
		},
		// Real proof for tx 0x198d…57e0; `signers` trimmed from 29 to 2.
		example: {
			txid: "198d642edb1104a1757a8c353ad61231d0422ecb6ba83aa1ce45d05df44157e0",
			index_block_hash:
				"990152a894e12288960c8b68e5790ad7994f9d261e9ad8adc13c72e76f914339",
			block_height: 9048502,
			tx_index: 1,
			raw_tx:
				"000000000104004ba0f04696ab911b7009e3421913e1f5768c222400000000000001090000000000000bb8000123767ba956a0545b2543f059d003500767330fad1f4e6cce3d734c8719bfca9226c07dc6e64edb83078cb34e83c6b430d4a260628af821041f51eb5f21e444390302000000010102164ba0f04696ab911b7009e3421913e1f5768c222414f6decc7cfff2a413bd7cd4f53c25ad7fd1899acc0a736274632d746f6b656e0a736274632d746f6b656e01000000000000012c0214f6decc7cfff2a413bd7cd4f53c25ad7fd1899acc0a736274632d746f6b656e087472616e7366657200000004010000000000000000000000000000012c05164ba0f04696ab911b7009e3421913e1f5768c222405161a3cb3edf945d27fa141d1de2deb9093ec74147f09",
			raw_header:
				"0100000000008a11b60000006643539084f394038c2267d08e5e5c52b9da2d99f4360c91a5314c3cac40ac15f4397b92360ccaa5adaeda6ebc5587511f33b1495fe1d1f66d10b0bfc1ef83918390f25ad4f0b7f5ddf76fa79782e92da2315856590664d9c179ccc0143e35f99140069ea4517ab4ca79e39f0e54b406b1b68b5f8c29e25750000000006ab3d0c2012ae8acc3a85100ae9eecf07468c694fee3cb585c423a0df3054991c77f4fa3fb4fc7b300f1b332f02ec0488c4033c7eb72abec17999c01326d222225f430e56d000000130016f1a9fb8ef3c85b04bd863818f4b47680de8f33e375b2872fbdd5b94d1664624488458f13383478becec32e9ce8ac9b2d0292d2773b37bf1c5943e87cf35b31006dbcd0a22c1eaf81d34dd1c2f25a1e05b7d6e5fdd3c5d8c7e4b96aa4472088e14d8b7ece3427f77fbcfd4027e7bd27be1388ddb68efb8debf8dfe48da558987400e3df41a2cc852d41b6db8f67c8e6c7bf1c31d185c87b019d349a5d6713c951ca43837c05b62a9f0b58ac4403a98233f1e1573e031fae90306ccd618dff1ce8eb01f4bba3a39010779d4870906d1f7e66115b8146f6b70b4e4fee3a402fa484c1d40146832b8fb21ab3328d7588e3861d9c614522692bd14fb763c77a2203d0b86a010075c0105d54deac9a6388734e0519d7ba90024727f02d65b8fd2cd788eca9350c6f6c7ff52200e41cefbf19873bcb9c17068ca9b093fd032dd68683348e95550083c787948e7bd477341747c8769ce2e9c8a420cb137d3609b5e90163f0c56ac3747219c113b0b5018aefa1dc9bd415b21b48173cb9c42f96f19cf143a77261340092179e100c58cfc2b3ee3271eca056ad98c986a1b434296eb1bb00986f3c1a7e70d89fdcbb983f216b9b9d5b5bf21093f58bf2e022fb0010f6706010ebe8c09f01bf06697f3e93883ebf59f83a98bc032d7b3da70886b6e44309cd77855dc1bf8c099084b40609c0a4e3d04806a0fd23391ad79745ba52b122838e3edf6359aa2d006d529e1f590e58b3d1519b719d1149e1babfa1cf20b164167199da2804dec7004159c9f6cb90f265b0d7c3338905de677087bbf9e40a7f06159a4697014756c501726fe445f8a4c876138ff40581e34a659463f97d7b2d1cc843b82d5c8ec9cd2e326ab34b509f4c193f424ebd2ddd729f007687c88b66af59ddda1036b1c7da8700d9a1b7f528df90661c608fd1935d95abb0f638b780573101837863353daf50c529e02703891e885ffa2603ca19a8ab1724c07795e6ab458e93abdca27ac67c3600c4202f95645edb945c2659345fd1dc5043d9fd178c398ddb2ed55ffc5bb9c62f2a61ada05578631cd6523fadf4a47be96133216b5cd421222a1289914ec41d5600ae2119da699f9eea1a8c49b0cf63c2ed5191d141491f11893869e04f24ad14d20dabc52b11e4418cd46610709c7d6456ff0a235760dc39c7e4c057fc8802fa4101813c588a7730569283f517b53949f67aa46a214530dab382da6ec3afc7014ede023706361ec717f8487a88f9d8ae9f912b3033124fccf8c98e5bcf382208febf016ad6d2d6a0c77ae937dc663b7111ab145e4df0248bcb1da80dce6b5bf0061539705f37412cf59476a22ee6677c20c9b980f263f8c1d4c79acd8d7166ff1a7b4f00aecd8f47fee2d6819993aa0d2e3e4872e2a95550c7403491f9764ebfa832f38b61704739abda8cfb0e05d8020efa5e49a5704dbd82f79fd3638b61005c37867c00025ea0925e7583f2f43c9ad4ff6ceaa8ef6bb62cb15265ebf684ca9005f5bb9312009b7e7bc171291c4c2530b74b275e57fc53072cd381a1cb27dc63232c0835007a5b80bc0b5af6848568468cc2a10f74789e1a1e0bcf6f18bb45f8df4e7a19f55c26f593b23aa76c2b7171aff4b062a58f6611da097071298621735521c7ee110062254da4170c6e66963e8a74c9a4fb5797e4247f5ccd8784c82d70ae96f5f01644e6b7733ca93f0e065fc165e152b4abd602687f2f081ab39c8f0943d3b51ea90001000000010100000000",
			tx_merkle_path: [
				{
					position: "left",
					hash: "ea5ecd867b9945b06aecdf77117de46ae9fd055b137be1fecc1dee38f56b19af",
				},
				{
					position: "right",
					hash: "398e676d798b758c66c50e21a83b4c6c8c20a5ffc8552b61d1df160f36a0c23c",
				},
				{
					position: "right",
					hash: "d1315b8f5f61861868657a0ab2c8c62332bb77a74a833567427a9f95ab86c1eb",
				},
			],
			consensus: {
				reward_cycle: 143,
				reward_set: {
					signers: [
						{
							signing_key:
								"0209130bec93e83b23d3366adfcbe0a1641057b9c48102572d892fe8f78de2bee7",
							weight: 646,
						},
						{
							signing_key:
								"0216436e7785e1dc55cf4350ac1f90e45daf0ec5b57bce13a32551a513446e71d1",
							weight: 9,
						},
					],
					total_weight: 4000,
				},
			},
		},
	},
	PrintSchema: {
		type: "object",
		description:
			"A contract's print payloads, grouped by `topic` and typed field by field from the events sampled.",
		required: [
			"contract_id",
			"topics",
			"sampled",
			"total_events",
			"total_events_capped",
			"sample",
			"tip",
		],
		properties: {
			contract_id: { type: "string", description: "The contract read." },
			topics: {
				type: "array",
				description:
					"One entry per `topic` value. Prints with no string `topic` group under `*`.",
				items: {
					type: "object",
					properties: {
						topic: { type: "string", description: "The topic value." },
						count: {
							type: "integer",
							description: "Sampled events with this topic.",
						},
						first_height: {
							type: "integer",
							description: "Lowest block height seen for it.",
						},
						last_height: {
							type: "integer",
							description: "Highest block height seen for it.",
						},
						non_tuple: {
							type: "boolean",
							description: "Whether some payloads were not tuples.",
						},
						fields: {
							type: "array",
							description: "Tuple fields, `topic` excluded.",
							items: {
								type: "object",
								properties: {
									name: {
										type: "string",
										description: "Tuple key as printed (kebab-case).",
									},
									camel_name: {
										type: "string",
										description:
											"The key a subgraph handler sees on `event.data`.",
									},
									clarity_type: {
										type: "string",
										description:
											"Clarity type. buff and string lengths are the largest seen.",
									},
									ts_type: {
										type: "string",
										description: "The decoded TypeScript type.",
									},
									column_type: {
										type: "string",
										description: "Subgraph column type that fits it.",
									},
									always_present: {
										type: "boolean",
										description:
											"Present in every sampled event of this topic.",
									},
									optional_some_rate: {
										type: "number",
										description:
											"For optionals: share of samples that were `some`.",
									},
								},
							},
						},
					},
				},
			},
			sampled: {
				type: "boolean",
				description:
					"`true` when the contract has more print events than were read.",
			},
			total_events: {
				type: "integer",
				description:
					"Canonical print events for the contract, capped at 50000.",
			},
			total_events_capped: {
				type: "boolean",
				description: "`true` when `total_events` hit the cap.",
			},
			sample: {
				type: "object",
				description: "What was read.",
				properties: {
					size: { type: "integer", description: "Events sampled." },
					newest_height: {
						type: ["integer", "null"],
						description: "Highest block height sampled.",
					},
					oldest_height: {
						type: ["integer", "null"],
						description: "Lowest block height sampled.",
					},
				},
			},
			tip: ref("Tip"),
		},
		example: {
			contract_id:
				"SP2BM6AQSMQ04CX8KDE62QBFVZTDZ2ZX80GZJSBZ4.zc-claim-helper-v2",
			topics: [
				{
					topic: "zc-claim-ok",
					count: 2,
					first_height: 9004646,
					last_height: 9004646,
					non_tuple: false,
					fields: [
						{
							name: "earned",
							camel_name: "earned",
							clarity_type: "uint",
							ts_type: "bigint",
							column_type: "uint",
							always_present: true,
						},
						{
							name: "reward-cycle",
							camel_name: "rewardCycle",
							clarity_type: "uint",
							ts_type: "bigint",
							column_type: "uint",
							always_present: true,
						},
						{
							name: "staker",
							camel_name: "staker",
							clarity_type: "principal",
							ts_type: "string",
							column_type: "principal",
							always_present: true,
						},
						{
							name: "withdrawal-request",
							camel_name: "withdrawalRequest",
							clarity_type: "(optional ?)",
							ts_type: "unknown | null",
							column_type: "jsonb",
							always_present: true,
							optional_some_rate: 0,
						},
					],
				},
				{
					topic: "claim-many",
					count: 1,
					first_height: 9004646,
					last_height: 9004646,
					non_tuple: false,
					fields: [
						{
							name: "err-count",
							camel_name: "errCount",
							clarity_type: "uint",
							ts_type: "bigint",
							column_type: "uint",
							always_present: true,
						},
						{
							name: "manager",
							camel_name: "manager",
							clarity_type: "principal",
							ts_type: "string",
							column_type: "principal",
							always_present: true,
						},
						{
							name: "ok-count",
							camel_name: "okCount",
							clarity_type: "uint",
							ts_type: "bigint",
							column_type: "uint",
							always_present: true,
						},
						{
							name: "submitted",
							camel_name: "submitted",
							clarity_type: "uint",
							ts_type: "bigint",
							column_type: "uint",
							always_present: true,
						},
					],
				},
			],
			sampled: false,
			total_events: 3,
			total_events_capped: false,
			sample: { size: 3, newest_height: 9004646, oldest_height: 9004646 },
			tip: TIP_EXAMPLE,
		},
	},
	IndexDiscovery: {
		type: "object",
		description: "Every Index route with the filters it accepts.",
		required: ["routes", "auth", "cursor"],
		properties: {
			routes: {
				type: "array",
				description:
					"One entry per route: `path`, `method`, `description`, and `filters` where it takes any. The `/v1/index/events` entry adds `event_types` and `event_type_filters` (columns and accepted filters per type).",
				items: { type: "object" },
			},
			auth: { type: "string", description: "How to authenticate, in prose." },
			cursor: {
				type: "object",
				description: "Cursor format and how to resume with it.",
				properties: {
					format: { type: "string", description: "Cursor shape." },
					semantics: { type: "string", description: "How to use it." },
				},
			},
		},
		// Real response, `routes` trimmed to two of 22 entries. `auth` is left
		// out: the route still prints the hosted `sk-sl_*` key line
		// (routes/index.ts), which is wrong for a self-hosted instance.
		example: {
			routes: [
				{
					path: "/v1/index/ft-transfers",
					method: "GET",
					description:
						"Alias for /events?event_type=ft_transfer. Fungible token transfers, decoded + filterable.",
					filters: [
						"limit",
						"cursor",
						"from_cursor",
						"from_height",
						"to_height",
						"contract_id",
						"sender",
						"recipient",
						"asset_identifier",
						"fields",
					],
				},
				{
					path: "/v1/index/blocks",
					method: "GET",
					description:
						"Canonical blocks, cursor-paginated. Returns blocks[] ({block_height, block_hash, parent_hash, burn_block_height, burn_block_hash, block_time, canonical}), next_cursor, tip.",
					filters: [
						"limit",
						"cursor",
						"from_cursor",
						"from_height",
						"to_height",
					],
				},
			],
			cursor: {
				format: "<block_height>:<event_index>",
				semantics:
					"opaque resume token; pass back unchanged to continue. Equals last event's cursor (inclusive on output, exclusive on input).",
			},
		},
	},
};
