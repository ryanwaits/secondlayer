import { Hono } from "hono";

const OPENAPI_SPEC = {
	openapi: "3.1.0",
	info: {
		title: "Secondlayer Public API",
		version: "1.0.0",
		description:
			"Public surfaces: Datasets (curated, anon), Index (semantic FT/NFT, anon-readable), Streams (raw firehose, bearer). Cursor format is `<block_height>:<event_index>` across all surfaces.",
	},
	servers: [
		{ url: "https://api.secondlayer.tools", description: "Production" },
	],
	tags: [
		{ name: "datasets", description: "Curated datasets, anon" },
		{ name: "index", description: "Semantic indexes (FT/NFT transfers)" },
		{ name: "streams", description: "Raw firehose, bearer" },
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
		"/v1/openapi.json": {
			get: { summary: "This document", responses: ok() },
		},
		"/v1/datasets": {
			get: {
				tags: ["datasets"],
				summary: "Datasets discovery",
				responses: ok(),
			},
		},
		"/v1/datasets/stx-transfers": {
			get: {
				tags: ["datasets"],
				summary: "STX transfer events",
				parameters: [
					{ $ref: "#/components/parameters/Limit" },
					{ $ref: "#/components/parameters/Cursor" },
					qp("from_block", "integer"),
					qp("to_block", "integer"),
					qp("sender", "string"),
					qp("recipient", "string"),
				],
				responses: envelope(),
			},
		},
		"/v1/datasets/sbtc/events": {
			get: {
				tags: ["datasets"],
				summary: "sBTC bridge events",
				parameters: [
					{ $ref: "#/components/parameters/Limit" },
					{ $ref: "#/components/parameters/Cursor" },
					qp("from_block", "integer"),
					qp("to_block", "integer"),
					qp("topic", "string"),
					qp("bitcoin_txid", "string"),
					qp("request_id", "string"),
					qp("sender", "string"),
				],
				responses: envelope(),
			},
		},
		"/v1/datasets/sbtc/token-events": {
			get: {
				tags: ["datasets"],
				summary: "sBTC SIP-010 token events",
				parameters: [
					{ $ref: "#/components/parameters/Limit" },
					{ $ref: "#/components/parameters/Cursor" },
					qp("from_block", "integer"),
					qp("to_block", "integer"),
					qp("event_type", "string"),
					qp("sender", "string"),
					qp("recipient", "string"),
				],
				responses: envelope(),
			},
		},
		"/v1/datasets/pox-4/calls": {
			get: {
				tags: ["datasets"],
				summary: "PoX-4 contract calls",
				parameters: [
					{ $ref: "#/components/parameters/Limit" },
					{ $ref: "#/components/parameters/Cursor" },
					qp("from_block", "integer"),
					qp("to_block", "integer"),
					qp("function_name", "string"),
					qp("stacker", "string"),
					qp("delegate_to", "string"),
					qp("signer_key", "string"),
					qp("reward_cycle", "integer"),
				],
				responses: envelope("calls"),
			},
		},
		"/v1/datasets/bns/events": {
			get: {
				tags: ["datasets"],
				summary: "BNS-V2 name lifecycle events",
				parameters: [
					{ $ref: "#/components/parameters/Limit" },
					{ $ref: "#/components/parameters/Cursor" },
					qp("from_block", "integer"),
					qp("to_block", "integer"),
					qp("topic", "string"),
					qp("namespace", "string"),
					qp("name", "string"),
					qp("owner", "string"),
				],
				responses: envelope(),
			},
		},
		"/v1/datasets/bns/namespace-events": {
			get: {
				tags: ["datasets"],
				summary: "BNS-V2 namespace lifecycle events",
				responses: envelope(),
			},
		},
		"/v1/datasets/bns/marketplace-events": {
			get: {
				tags: ["datasets"],
				summary: "BNS-V2 marketplace events",
				responses: envelope(),
			},
		},
		"/v1/datasets/bns/names": {
			get: {
				tags: ["datasets"],
				summary: "BNS-V2 names snapshot",
				responses: ok(),
			},
		},
		"/v1/datasets/bns/namespaces": {
			get: {
				tags: ["datasets"],
				summary: "BNS-V2 namespaces list",
				responses: ok(),
			},
		},
		"/v1/datasets/bns/resolve": {
			get: {
				tags: ["datasets"],
				summary: "Resolve a fully-qualified BNS-V2 name",
				parameters: [qp("fqn", "string", true)],
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
