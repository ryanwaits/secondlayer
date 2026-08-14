import type { InstanceMode } from "@secondlayer/shared/mode";
import { getInstanceMode } from "@secondlayer/shared/mode";
import { Hono } from "hono";
import { HOSTED_OPENAPI_PATHS } from "../route-manifest.ts";
import { MAX_LIMIT } from "./subgraph-query-helpers.ts";

/** `contract_id` on the two consume-able feeds accepts a comma-separated set,
 *  so one cursor can follow a whole protocol. */
const CONTRACT_ID_PARAM = qp(
	"contract_id",
	"string",
	false,
	"Contract principal, or a comma-separated set of up to 20 (e.g. `SP1.sbtc-token,SP1.sbtc-registry`). Mutually exclusive with `trait`.",
);

/** The public API description. Exported so the docs site can render it as the
 *  API reference instead of restating it by hand — `bun run openapi` in
 *  apps/web writes it to src/generated/openapi.json. */
export const OPENAPI_SPEC = {
	openapi: "3.1.0",
	"x-x402": {
		supported: "/v1/x402/supported",
		paidSurfaces: [
			"/v1/index/*",
			"/v1/streams/*",
			"POST /v1/subgraphs",
			"POST /v1/subgraphs/{name}/renew",
		],
		paymentHeader: "PAYMENT-SIGNATURE",
		receiptHeader: "PAYMENT-RESPONSE",
		sessionHeader: "PAYMENT-SESSION",
		balanceHeader: "PAYMENT-BALANCE",
		status: "experimental",
		note: "Experimental beta — surfaces and prices may change. When the pay-per-call rail is enabled, accountless requests on paid surfaces receive HTTP 402 with an accepts[] quote (x402 v2, network stacks:1). Sponsored transfers: the payer holds tokens, never gas. Index grants 1,000 free reads/day/IP before the 402; a paid Streams call opens a 500-call/1h session; a paid POST /v1/subgraphs deploys a wallet-owned subgraph (7-day TTL, renewable); POST /v1/x402/deposit loads a prepaid tab whose PAYMENT-BALANCE token debits per call with no on-chain round trip.",
	},
	info: {
		title: "Secondlayer Public API",
		version: "1.0.0",
		description:
			"Public surfaces: Index (decoded chain events — stx/ft/nft transfers, mints, burns, prints, stacking; anon-readable), Streams (raw firehose, bearer), Subgraphs (public subgraphs anon-readable, private with the owning account's bearer; `{ rows, next_cursor, tip }` envelope with `_id` keyset cursor, or a composite keyset cursor when `_sort` is used). Cursor format is `<block_height>:<event_index>` on Index/Streams; opaque on Subgraphs.",
	},
	servers: [{ url: "http://127.0.0.1:3800", description: "Local instance" }],
	tags: [
		{
			name: "index",
			description:
				"Decoded chain events (transfers, mints/burns, prints, stacking)",
		},
		{ name: "streams", description: "Raw firehose, bearer" },
		{
			name: "subgraphs",
			description: "Deployed subgraph reads — public anon, private bearer",
		},
	],
	components: {
		securitySchemes: {
			bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "sk-sl_*" },
		},
		schemas: {
			Tip: {
				type: "object",
				properties: {
					block_height: { type: "integer" },
					block_hash: { type: "string" },
					burn_block_height: { type: "integer" },
					lag_seconds: { type: "integer" },
				},
			},
			Reorg: {
				type: "object",
				properties: {
					detected_at: { type: "string", format: "date-time" },
					new_canonical_tip: { type: "string", example: "7960000:42" },
					new_canonical_height: { type: "integer" },
					new_canonical_event_index: { type: "integer" },
				},
			},
			CursorEnvelope: {
				type: "object",
				properties: {
					events: { type: "array", items: { type: "object" } },
					next_cursor: { type: ["string", "null"], example: "7960000:42" },
					tip: { $ref: "#/components/schemas/Tip" },
					reorgs: {
						type: "array",
						items: { $ref: "#/components/schemas/Reorg" },
					},
				},
			},
			RowsEnvelope: {
				type: "object",
				properties: {
					rows: { type: "array", items: { type: "object" } },
					next_cursor: { type: ["string", "null"], example: "1042" },
					tip: {
						type: "object",
						properties: {
							block_height: { type: "integer" },
							subgraph_height: { type: "integer" },
							blocks_behind: { type: "integer" },
						},
					},
				},
			},
			Error: {
				type: "object",
				properties: {
					error: { type: "string" },
					code: { type: "string" },
				},
			},
		},
		parameters: {
			Limit: {
				name: "limit",
				in: "query",
				schema: { type: "integer", minimum: 1, maximum: 1000 },
				description: "Page size; capped at 1000.",
			},
			Cursor: {
				name: "cursor",
				in: "query",
				schema: { type: "string", example: "7960000:42" },
			},
		},
	},
	paths: {
		"/v1": { get: { summary: "Surface discovery", responses: ok() } },
		"/v1/x402/supported": {
			get: {
				summary: "x402 pay-per-call capability advertisement",
				description:
					"Scheme, network (CAIP-2), priced surfaces, accepted assets, free-quota/session metadata, and the per-call USD floor for the pay-per-call rail. Public, no auth.",
			},
		},
		"/v1/subgraphs/deploy-paid": {
			post: {
				summary: "x402-paid subgraph deploy (actual path: POST /v1/subgraphs)",
				description:
					"Accountless deploy: pay the subgraph-deploy quote via x402 and the subgraph is owned by the paying wallet principal — live indexing from deploy (forward-only), expires in 7 days unless renewed (POST /v1/subgraphs/{name}/renew, subgraph-renew quote) or the account is claimed. Managed plane only.",
			},
		},
		"/v1/batch": {
			post: {
				summary: "Batch public reads",
				description:
					"Up to 10 public /v1 reads in one round trip. Body: { requests: [{ path, params? }] }. Each item keeps its own auth/quota/pay-per-call semantics; forwarded credentials apply to every item; results return in order with per-item status.",
			},
		},
		"/v1/x402/deposit": {
			post: {
				summary: "Load a prepaid x402 tab",
				description:
					"Pay once on-chain (?usd=<amount>, $0.25–$100, confirmed tier) and receive a PAYMENT-BALANCE token; subsequent Index/Streams calls carrying it debit the tab instantly. Responses report X-BALANCE-REMAINING-USD.",
			},
		},
		"/v1/x402/balance": {
			get: {
				summary: "Read a prepaid tab",
				description: "Current balance for the PAYMENT-BALANCE token presented.",
			},
		},
		"/v1/openapi.json": {
			get: { summary: "This document", responses: ok() },
		},
		"/v1/subgraphs": {
			get: {
				tags: ["subgraphs"],
				summary:
					"List readable subgraphs (public + your own with a bearer key)",
				responses: ok(),
			},
		},
		"/v1/subgraphs/{name}": {
			get: {
				tags: ["subgraphs"],
				summary: "Subgraph metadata: tables, columns, sync tip, doc links",
				parameters: [pp("name")],
				responses: ok(),
			},
		},
		"/v1/subgraphs/{name}/openapi.json": {
			get: {
				tags: ["subgraphs"],
				summary: "Generated OpenAPI spec for one subgraph",
				security: [{}, { bearerAuth: [] }],
				parameters: [pp("name")],
				responses: ok(),
			},
		},
		"/v1/subgraphs/{name}/schema.json": {
			get: {
				tags: ["subgraphs"],
				summary: "Generated agent schema for one subgraph",
				security: [{}, { bearerAuth: [] }],
				parameters: [pp("name")],
				responses: ok(),
			},
		},
		"/v1/subgraphs/{name}/docs.md": {
			get: {
				tags: ["subgraphs"],
				summary: "Generated markdown docs for one subgraph",
				security: [{}, { bearerAuth: [] }],
				parameters: [pp("name")],
				responses: ok(),
			},
		},
		"/v1/subgraphs/{name}/{table}": {
			get: {
				tags: ["subgraphs"],
				summary:
					"Rows, cursor-paginated by _id, or by _sort/_order ({ rows, next_cursor, tip }). Column filters via col.op=value, _limit, _fields.",
				security: [{}, { bearerAuth: [] }],
				parameters: [
					pp("name"),
					pp("table"),
					qp(
						"_limit",
						"integer",
						false,
						`Page size, 1–${MAX_LIMIT}. Non-integers, 0, negatives, and values above ${MAX_LIMIT} are rejected (400), not clamped.`,
					),
					qp(
						"cursor",
						"string",
						false,
						"Opaque; pass back the previous page's next_cursor verbatim. Its shape depends on whether _sort was used to fetch that page — do not hand-construct one, and don't replay a cursor from one _sort/_order under a different _sort/_order (400).",
					),
					qp(
						"_sort",
						"string",
						false,
						"Single column to sort by (no comma list — composite keyset pagination pairs it with the _id tiebreaker, which only works for one column). jsonb columns are rejected (no meaningful ordering). Omit to keep the default _id-only ordering.",
					),
					qp(
						"_order",
						"string",
						false,
						'"asc" or "desc" — direction of the _id scan, or of the _sort column when _sort is present (any other value is rejected).',
					),
					qp("_fields", "string"),
				],
				responses: rowsEnvelope(),
			},
		},
		"/v1/subgraphs/{name}/{table}/count": {
			get: {
				tags: ["subgraphs"],
				summary: "Count rows matching filters",
				parameters: [pp("name"), pp("table")],
				responses: ok(),
			},
		},
		"/v1/subgraphs/{name}/{table}/aggregate": {
			get: {
				tags: ["subgraphs"],
				summary:
					"Scalar aggregates (_count/_countDistinct/_sum/_min/_max) over filtered rows",
				parameters: [pp("name"), pp("table")],
				responses: ok(),
			},
		},
		"/v1/subgraphs/{name}/{table}/stream": {
			get: {
				tags: ["subgraphs"],
				summary: "SSE tail of new rows (?since=<block> to replay)",
				parameters: [pp("name"), pp("table")],
				responses: ok(),
			},
		},
		"/v1/index": {
			get: { tags: ["index"], summary: "Index discovery", responses: ok() },
		},
		"/v1/index/events": {
			get: {
				tags: ["index"],
				summary: "Decoded events by event_type",
				security: [{}, { bearerAuth: [] }],
				parameters: [
					{
						name: "event_type",
						in: "query",
						required: true,
						schema: {
							type: "string",
							enum: [
								"ft_transfer",
								"nft_transfer",
								"stx_transfer",
								"stx_mint",
								"stx_burn",
								"stx_lock",
								"ft_mint",
								"ft_burn",
								"nft_mint",
								"nft_burn",
								"print",
							],
						},
					},
					{ $ref: "#/components/parameters/Limit" },
					{ $ref: "#/components/parameters/Cursor" },
					qp("from_cursor", "string"),
					qp("from_height", "integer"),
					qp("to_height", "integer"),
					CONTRACT_ID_PARAM,
					qp("asset_identifier", "string"),
					qp("sender", "string"),
					qp("recipient", "string"),
				],
				responses: envelope(),
			},
		},
		"/v1/index/ft-transfers": {
			get: {
				tags: ["index"],
				summary: "Fungible token transfers",
				security: [{}, { bearerAuth: [] }],
				parameters: [
					{ $ref: "#/components/parameters/Limit" },
					{ $ref: "#/components/parameters/Cursor" },
					qp("from_cursor", "string"),
					qp("from_height", "integer"),
					qp("to_height", "integer"),
					qp("contract_id", "string"),
					qp("sender", "string"),
					qp("recipient", "string"),
				],
				responses: envelope(),
			},
		},
		"/v1/index/nft-transfers": {
			get: {
				tags: ["index"],
				summary: "NFT transfers",
				security: [{}, { bearerAuth: [] }],
				parameters: [
					{ $ref: "#/components/parameters/Limit" },
					{ $ref: "#/components/parameters/Cursor" },
					qp("from_cursor", "string"),
					qp("from_height", "integer"),
					qp("to_height", "integer"),
					qp("contract_id", "string"),
					qp("asset_identifier", "string"),
					qp("sender", "string"),
					qp("recipient", "string"),
				],
				responses: envelope(),
			},
		},
		"/v1/index/contract-calls": {
			get: {
				tags: ["index"],
				summary: "Decoded contract-call transactions",
				security: [{}, { bearerAuth: [] }],
				parameters: [
					{ $ref: "#/components/parameters/Limit" },
					{
						name: "cursor",
						in: "query",
						schema: { type: "string", example: "7960000:3" },
					},
					qp("from_cursor", "string"),
					qp("from_height", "integer"),
					qp("to_height", "integer"),
					CONTRACT_ID_PARAM,
					qp("function_name", "string"),
					qp("sender", "string"),
				],
				responses: envelope("contract_calls"),
			},
		},
		"/v1/index/canonical": {
			get: {
				tags: ["index"],
				summary: "Canonical block-hash map",
				security: [{}, { bearerAuth: [] }],
				parameters: [
					{ $ref: "#/components/parameters/Limit" },
					{ $ref: "#/components/parameters/Cursor" },
					qp("from_cursor", "string"),
					qp("from_height", "integer"),
					qp("to_height", "integer"),
				],
				responses: envelope("canonical"),
			},
		},
		"/v1/index/blocks": {
			get: {
				tags: ["index"],
				summary: "Canonical blocks",
				security: [{}, { bearerAuth: [] }],
				parameters: [
					{ $ref: "#/components/parameters/Limit" },
					{ $ref: "#/components/parameters/Cursor" },
					qp("from_cursor", "string"),
					qp("from_height", "integer"),
					qp("to_height", "integer"),
				],
				responses: envelope("blocks"),
			},
		},
		"/v1/index/blocks/{height_or_hash}": {
			get: {
				tags: ["index"],
				summary: "Block by height or hash",
				security: [{}, { bearerAuth: [] }],
				parameters: [
					{
						name: "height_or_hash",
						in: "path",
						required: true,
						schema: { type: "string", example: "182447" },
					},
				],
				responses: ok(),
			},
		},
		"/v1/index/transactions": {
			get: {
				tags: ["index"],
				summary: "Full transaction documents",
				security: [{}, { bearerAuth: [] }],
				parameters: [
					{ $ref: "#/components/parameters/Limit" },
					{
						name: "cursor",
						in: "query",
						schema: { type: "string", example: "7960000:3" },
					},
					qp("from_cursor", "string"),
					qp("from_height", "integer"),
					qp("to_height", "integer"),
					qp("type", "string"),
					qp("sender", "string"),
					qp("contract_id", "string"),
				],
				responses: envelope("transactions"),
			},
		},
		"/v1/index/transactions/{tx_id}": {
			get: {
				tags: ["index"],
				summary: "Transaction by tx_id",
				security: [{}, { bearerAuth: [] }],
				parameters: [
					{
						name: "tx_id",
						in: "path",
						required: true,
						schema: { type: "string" },
					},
				],
				responses: ok(),
			},
		},
		"/v1/index/stacking": {
			get: {
				tags: ["index"],
				summary: "PoX-4 stacking actions",
				security: [{}, { bearerAuth: [] }],
				parameters: [
					{ $ref: "#/components/parameters/Limit" },
					{
						name: "cursor",
						in: "query",
						schema: { type: "string", example: "7960000:3" },
					},
					qp("from_cursor", "string"),
					qp("from_height", "integer"),
					qp("to_height", "integer"),
					qp("function_name", "string"),
					qp("stacker", "string"),
					qp("caller", "string"),
				],
				responses: envelope("stacking"),
			},
		},
		"/v1/index/pox/cycles": {
			get: {
				tags: ["index"],
				summary: "PoX-4 reward-cycle aggregates",
				description:
					"Per-cycle rollup over pox4_calls: total stacked ustx, unique stackers/delegators, action count, block range, function breakdown. Cursor-paginated by reward_cycle descending; may carry an optional `notes` field (decoder disabled, or PoX-4 era closed at the epoch 4.0 fork).",
				security: [{}, { bearerAuth: [] }],
				parameters: [
					{ $ref: "#/components/parameters/Limit" },
					{
						name: "cursor",
						in: "query",
						schema: { type: "integer", example: 84 },
						description: "Reward cycle to page backward from (exclusive).",
					},
				],
				responses: {
					"200": {
						description: "Cursor-paginated reward-cycle list",
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: {
										cycles: { type: "array", items: { type: "object" } },
										next_cursor: { type: ["integer", "null"], example: 83 },
										tip: { $ref: "#/components/schemas/Tip" },
										notes: { type: "string" },
									},
								},
							},
						},
					},
					"400": jsonError(),
					"401": jsonError(),
					"429": jsonError(),
				},
			},
		},
		"/v1/index/pox/cycles/{reward_cycle}": {
			get: {
				tags: ["index"],
				summary: "PoX-4 reward-cycle aggregate by cycle number",
				security: [{}, { bearerAuth: [] }],
				parameters: [
					{
						name: "reward_cycle",
						in: "path",
						required: true,
						schema: { type: "integer", example: 142 },
					},
				],
				responses: {
					"200": {
						description: "OK",
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: {
										cycle: { type: "object" },
										tip: { $ref: "#/components/schemas/Tip" },
										notes: { type: "string" },
									},
								},
							},
						},
					},
					"400": {
						description: "reward_cycle is not a non-negative integer",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/Error" },
							},
						},
					},
					"404": {
						description: "No cycle found for reward_cycle",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/Error" },
							},
						},
					},
				},
			},
		},
		"/v1/index/pox5/events": {
			get: {
				tags: ["index"],
				summary: "PoX-5 boot-contract events (decoded)",
				description:
					"Decoded print log of the pox-5 boot contract (SIP-045 Bitcoin Staking) — all 19 topics (stake, stake-update, register-signer, unstake, claim-rewards, etc.), one row per print. Starts at the epoch 4.0 hard fork, where /v1/index/stacking's pox-4 feed ends.",
				security: [{}, { bearerAuth: [] }],
				parameters: [
					{ $ref: "#/components/parameters/Limit" },
					{
						name: "cursor",
						in: "query",
						schema: { type: "string", example: "7960000:3" },
					},
					qp("from_cursor", "string"),
					qp("from_height", "integer"),
					qp("to_height", "integer"),
					qp("confirmed", "boolean"),
					qp("topic", "string"),
					qp("staker", "string"),
					qp("signer", "string"),
					qp("signer_manager", "string"),
					qp("bond_index", "integer"),
					qp("reward_cycle", "integer"),
					qp("fields", "string"),
				],
				responses: envelope("events"),
			},
		},
		"/v1/index/sbtc/events": {
			get: {
				tags: ["index"],
				summary: "sBTC peg events (decoded)",
				description:
					"Decoded sBTC peg protocol-state events Hiro declined to filter (SBA #1709): completed-deposit, withdrawal-create/accept/reject, key-rotation, update-protocol-contract.",
				security: [{}, { bearerAuth: [] }],
				parameters: [
					{ $ref: "#/components/parameters/Limit" },
					{
						name: "cursor",
						in: "query",
						schema: { type: "string", example: "7960000:3" },
					},
					qp("from_cursor", "string"),
					qp("from_height", "integer"),
					qp("to_height", "integer"),
					qp("confirmed", "boolean"),
					qp("topic", "string"),
					qp("sender", "string"),
					qp("request_id", "integer"),
					qp("bitcoin_txid", "string"),
				],
				responses: envelope("events"),
			},
		},
		"/v1/index/sbtc/deposits": {
			get: {
				tags: ["index"],
				summary: "sBTC peg-ins (completed deposits)",
				security: [{}, { bearerAuth: [] }],
				parameters: [
					{ $ref: "#/components/parameters/Limit" },
					{
						name: "cursor",
						in: "query",
						schema: { type: "string", example: "7960000:3" },
					},
					qp("from_cursor", "string"),
					qp("from_height", "integer"),
					qp("to_height", "integer"),
					qp("confirmed", "boolean"),
					qp("sender", "string"),
					qp("bitcoin_txid", "string"),
				],
				responses: envelope("deposits"),
			},
		},
		"/v1/index/sbtc/withdrawals": {
			get: {
				tags: ["index"],
				summary: "sBTC peg-outs (lifecycle, one per request_id)",
				description:
					"Peg-outs rolled up per request_id with derived status (REQUESTED→ACCEPTED|REJECTED) and the committed BTC sweep_txid. Never immutably cached (status mutates as later events land).",
				security: [{}, { bearerAuth: [] }],
				parameters: [
					{ $ref: "#/components/parameters/Limit" },
					{
						name: "cursor",
						in: "query",
						schema: { type: "string", example: "7960000:3" },
					},
					qp("from_cursor", "string"),
					qp("from_height", "integer"),
					qp("to_height", "integer"),
					qp("confirmed", "boolean"),
					qp("status", "string"),
					qp("sender", "string"),
					qp("request_id", "integer"),
					qp("settlement_confirmed", "boolean"),
				],
				responses: envelope("withdrawals"),
			},
		},
		"/v1/index/sbtc/withdrawals/{request_id}": {
			get: {
				tags: ["index"],
				summary: "sBTC peg-out lifecycle by request_id",
				security: [{}, { bearerAuth: [] }],
				parameters: [
					{
						name: "request_id",
						in: "path",
						required: true,
						schema: { type: "integer", example: 42 },
					},
				],
				responses: ok(),
			},
		},
		"/v1/index/sbtc/deposits/{bitcoin_txid}": {
			get: {
				tags: ["index"],
				summary: "sBTC peg-in by Bitcoin txid",
				security: [{}, { bearerAuth: [] }],
				parameters: [
					{
						name: "bitcoin_txid",
						in: "path",
						required: true,
						schema: { type: "string" },
					},
				],
				responses: ok(),
			},
		},
		"/v1/index/sbtc/summary": {
			get: {
				tags: ["index"],
				summary: "sBTC peg summary scoreboard",
				description:
					"One scalar aggregate over the whole bridge: lifecycle counts, net peg flow, locked sats, and circulating sBTC supply (mints − burns). All-time canonical totals; no params.",
				security: [{}, { bearerAuth: [] }],
				parameters: [],
				responses: ok(),
			},
		},
		"/v1/index/mempool": {
			get: {
				tags: ["index"],
				summary: "Pending (unconfirmed) transactions",
				security: [{}, { bearerAuth: [] }],
				parameters: [
					{ $ref: "#/components/parameters/Limit" },
					{
						name: "cursor",
						in: "query",
						schema: { type: "string", example: "10428" },
					},
					qp("from_cursor", "string"),
					qp("sender", "string"),
					qp("type", "string"),
					qp("function_name", "string"),
				],
				responses: envelope("mempool"),
			},
		},
		"/v1/index/mempool/{tx_id}": {
			get: {
				tags: ["index"],
				summary: "Pending transaction by tx_id",
				security: [{}, { bearerAuth: [] }],
				parameters: [
					{
						name: "tx_id",
						in: "path",
						required: true,
						schema: { type: "string" },
					},
				],
				responses: ok(),
			},
		},
		"/v1/index/contracts/{contract_id}/print-schema": {
			get: {
				tags: ["index"],
				summary: "Empirical per-topic print payload schemas for a contract",
				security: [{}, { bearerAuth: [] }],
				parameters: [pp("contract_id")],
				responses: ok(),
			},
		},
		"/v1/streams": {
			get: { tags: ["streams"], summary: "Streams discovery", responses: ok() },
		},
		"/v1/streams/events": {
			get: {
				tags: ["streams"],
				summary: "Raw event firehose",
				security: [{ bearerAuth: [] }],
				parameters: [
					{ $ref: "#/components/parameters/Limit" },
					{ $ref: "#/components/parameters/Cursor" },
					qp("from_cursor", "string"),
					qp("from_height", "integer"),
					qp("to_height", "integer"),
					qp("types", "string"),
					qp("contract_id", "string"),
				],
				responses: envelope(),
			},
		},
		"/v1/streams/reorgs": {
			get: {
				tags: ["streams"],
				summary: "Chain reorg history",
				security: [{ bearerAuth: [] }],
				parameters: [
					qp("since", "string"),
					{ $ref: "#/components/parameters/Limit" },
				],
				responses: ok(),
			},
		},
		"/v1/streams/canonical/{height}": {
			get: {
				tags: ["streams"],
				summary: "Canonical block by height",
				security: [{ bearerAuth: [] }],
				parameters: [
					{
						name: "height",
						in: "path",
						required: true,
						schema: { type: "integer" },
					},
				],
				responses: ok(),
			},
		},
		"/v1/streams/tip": {
			get: {
				tags: ["streams"],
				summary: "Current chain tip",
				security: [{ bearerAuth: [] }],
				responses: ok(),
			},
		},
	},
};

/** OSS drops hosted x402 / paid-deploy paths and the x-x402 extension. */
export function openapiSpec(
	mode: InstanceMode = getInstanceMode(),
): typeof OPENAPI_SPEC {
	if (mode === "platform") return OPENAPI_SPEC;
	const paths: Record<string, unknown> = { ...OPENAPI_SPEC.paths };
	for (const key of HOSTED_OPENAPI_PATHS) {
		delete paths[key];
	}
	paths["/v1/instance"] = {
		get: {
			tags: ["instance"],
			summary: "Local instance catalog",
			description:
				"Instance status, local subgraphs, subscriptions, and default features. No signup or pricing.",
			responses: { "200": { description: "Catalog" } },
		},
	};
	paths["/v1/instance/features"] = {
		get: {
			tags: ["instance"],
			summary: "Default feature manifest",
			responses: { "200": { description: "Features" } },
		},
	};
	return {
		openapi: OPENAPI_SPEC.openapi,
		info: {
			...OPENAPI_SPEC.info,
			description:
				"This instance: Index (decoded chain events), Streams (raw firehose), Subgraphs (your schema). Cursor format is `<block_height>:<event_index>` on Index/Streams; opaque on Subgraphs.",
		},
		servers: [{ url: "/", description: "This instance" }],
		tags: OPENAPI_SPEC.tags,
		components: OPENAPI_SPEC.components,
		paths,
	} as typeof OPENAPI_SPEC;
}

function qp(
	name: string,
	type: string,
	required = false,
	description?: string,
) {
	return {
		name,
		in: "query",
		required,
		schema: { type },
		...(description ? { description } : {}),
	};
}

function pp(name: string) {
	return { name, in: "path", required: true, schema: { type: "string" } };
}

function ok() {
	return {
		"200": { description: "OK", content: { "application/json": {} } },
		"400": jsonError(),
	};
}

function envelope(_arrayKey = "events") {
	return {
		"200": {
			description: "Cursor-paginated envelope",
			content: {
				"application/json": {
					schema: { $ref: "#/components/schemas/CursorEnvelope" },
				},
			},
		},
		"400": jsonError(),
		"401": jsonError(),
		"429": jsonError(),
		"503": {
			description: "Tip unavailable",
			content: { "application/json": {} },
		},
	};
}

function rowsEnvelope() {
	return {
		"200": {
			description:
				"Row envelope, _id keyset cursor by default (composite with the sort column when _sort is used)",
			content: {
				"application/json": {
					schema: { $ref: "#/components/schemas/RowsEnvelope" },
				},
			},
		},
		"400": jsonError(),
		"401": jsonError(),
		"404": jsonError(),
		"429": jsonError(),
	};
}

function jsonError() {
	return {
		description: "Error",
		content: {
			"application/json": {
				schema: { $ref: "#/components/schemas/Error" },
			},
		},
	};
}

export function createOpenApiRouter() {
	const router = new Hono();
	router.get("/", (c) => c.json(openapiSpec()));
	return router;
}

export default createOpenApiRouter();
