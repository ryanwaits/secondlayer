import { Hono } from "hono";

const OPENAPI_SPEC = {
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
			"Public surfaces: Index (semantic FT/NFT, anon-readable), Streams (raw firehose, bearer), Subgraphs (public subgraphs anon-readable, private with the owning account's bearer; `{ rows, next_cursor, tip }` envelope with `_id` keyset cursor). Cursor format is `<block_height>:<event_index>` on Index/Streams.",
	},
	servers: [
		{ url: "https://api.secondlayer.tools", description: "Production" },
	],
	tags: [
		{ name: "index", description: "Semantic indexes (FT/NFT transfers)" },
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
					"Rows, cursor-paginated by _id ({ rows, next_cursor, tip }). Column filters via col.op=value, _limit, _fields, _order=asc|desc.",
				security: [{}, { bearerAuth: [] }],
				parameters: [
					pp("name"),
					pp("table"),
					{ $ref: "#/components/parameters/Limit" },
					qp("cursor", "string"),
					qp("_order", "string"),
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
					qp("contract_id", "string"),
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
					qp("contract_id", "string"),
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

function qp(name: string, type: string, required = false) {
	return { name, in: "query", required, schema: { type } };
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
			description: "Row envelope, _id keyset cursor",
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
	router.get("/", (c) => c.json(OPENAPI_SPEC));
	return router;
}

export default createOpenApiRouter();
